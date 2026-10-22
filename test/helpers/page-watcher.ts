import type { Mock } from 'vitest'
import type { PageContext } from '../../packages/core/src'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { normalizePath } from 'vite'
import { vi } from 'vitest'

const require = createRequire(new URL('../../packages/core/package.json', import.meta.url))
const { default: chokidar } = require('chokidar')

interface MockPageWatcher extends EventEmitter {
  add: Mock
  close: Mock<() => Promise<void>>
}

function watcher(): MockPageWatcher {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    add: vi.fn(),
    close: vi.fn(async () => {
      emitter.removeAllListeners()
    }),
  })
}

/** 只替换原生事件源，保留页面监听的注册、来源刷新和关闭流程 */
export function mockPageWatchers(): { entrances: Map<string, EventEmitter> } {
  vi.spyOn(chokidar, 'watch').mockImplementation(() => watcher())
  const entrances = new Map<string, EventEmitter>()
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

/** 当前实例可能随目标变化而替换，派发事件前重新取得 */
export function currentPageWatcher(ctx: PageContext): MockPageWatcher | undefined {
  return (ctx as unknown as { pageWatcher: { watcher?: MockPageWatcher } }).pageWatcher.watcher
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
