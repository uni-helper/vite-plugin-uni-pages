import type { Mock } from 'vitest'
import type { PageContext } from '../../packages/core/src'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { normalizePath } from 'vite'
import { vi } from 'vitest'

const require = createRequire(new URL('../../packages/core/package.json', import.meta.url))
const { default: chokidar } = require('chokidar')

export interface FakeWatcher extends EventEmitter {
  add: Mock
  close: Mock<() => Promise<void>>
  options?: Record<string, unknown>
  /** 标记这是受控替身，真实 watcher 的就绪等待不能用在它身上 */
  __controlled: true
}

interface PageWatchState {
  watcher?: FakeWatcher
  recoveryWatchers: ReadonlyMap<string, unknown>
  started: boolean
}

/** 创建一个带 add/close 的 watcher 替身；受控监听和测试共享 watcher 共用 */
export function createFakeWatcher(): FakeWatcher {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    add: vi.fn(),
    close: vi.fn(async () => {
      emitter.removeAllListeners()
    }),
    options: {},
    __controlled: true as const,
  })
}

function watcher(): FakeWatcher {
  return createFakeWatcher()
}

/** 只替换原生事件源，保留页面监听的注册、来源刷新和关闭流程 */
export function mockPageWatchers(): { entrances: Map<string, FakeWatcher> } {
  vi.spyOn(chokidar, 'watch').mockImplementation(() => watcher())
  const entrances = new Map<string, FakeWatcher>()
  vi.spyOn(fs, 'watch').mockImplementation(((file: string, _options: unknown, listener: (...args: any[]) => void) => {
    const observed = watcher()
    observed.on('change', listener)
    entrances.set(normalizePath(file), observed)
    return observed
  }) as unknown as typeof fs.watch)
  vi.spyOn(fs, 'watchFile').mockImplementation(((file: string, _options: unknown, listener: (...args: any[]) => void) => {
    const observed = entrances.get(normalizePath(file)) ?? watcher()
    observed.on('change', listener)
    entrances.set(normalizePath(file), observed)
    return observed
  }) as unknown as typeof fs.watchFile)
  vi.spyOn(fs, 'unwatchFile').mockImplementation((file, listener) => {
    if (listener)
      entrances.get(normalizePath(String(file)))?.off('change', listener)
  })
  return { entrances }
}

/** 读取当前内容监听与恢复入口的状态 */
export function pageWatchState(ctx: PageContext): PageWatchState {
  return (ctx as unknown as { pageWatcher: PageWatchState }).pageWatcher
}

/** 当前实例可能随目标变化而替换，派发事件前重新取得 */
export function currentPageWatcher(ctx: PageContext): FakeWatcher | undefined {
  return pageWatchState(ctx).watcher
}

export async function flushPageUpdates(ctx: PageContext): Promise<void> {
  const state = ctx as unknown as {
    pendingPageFlush?: Promise<void>
    pendingPageUpdate?: unknown
    pendingUpdate: Promise<void>
  }
  while (true) {
    const update = state.pendingUpdate
    await state.pendingPageFlush
    await update
    if (!state.pendingPageFlush && !state.pendingPageUpdate && update === state.pendingUpdate)
      return
  }
}
