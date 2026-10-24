import type { PagesConfig } from '@uni-helper/uni-pages-types'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src/context'
import { currentPageWatcher, mockPageWatchers, pageWatchState } from './helpers/page-watcher'

let root: string
let ctx: PageContext | undefined

function gate<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture(parser: () => Promise<PagesConfig>) {
  ctx = new PageContext({
    dts: false,
    configSource: { files: 'pages.config.json', extensions: [], parser },
  }, root, 'h5')
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  const setup = () => ctx!.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  return { context: ctx, watcher, setup }
}

function expectDisposed(context: PageContext, watcher: EventEmitter): void {
  expect(watcher.eventNames()).toEqual([])
  expect(currentPageWatcher(context)).toBeUndefined()
  expect(pageWatchState(context).recoveryWatchers.size).toBe(0)
}

beforeEach(() => {
  mockPageWatchers()
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-context-disposal-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view/></template>')
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
})

afterEach(async () => {
  await ctx?.disposeWatchers()
  ctx = undefined
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('页面上下文释放', () => {
  it('初始化尚未结束时关闭，迟到的监听注册不能重新占用资源', async () => {
    const entered = gate<void>()
    const config = gate<PagesConfig>()
    const { context, watcher, setup } = fixture(async () => {
      entered.resolve()
      return config.promise
    })
    const initialization = context.updatePagesJSON().then(setup)
    await entered.promise

    let closed = false
    const closing = context.disposeWatchers().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)

    config.resolve({})
    await Promise.all([initialization, closing])

    expect(closed).toBe(true)
    expectDisposed(context, watcher)
    expect(watcher.add).not.toHaveBeenCalled()
  })

  it('关闭时排空正在执行的生成，取消尚未开始的配置和页面更新', async () => {
    const entered = gate<void>()
    const config = gate<PagesConfig>()
    const parser = vi.fn(async (): Promise<PagesConfig> => ({}))
    const { context, watcher, setup } = fixture(parser)
    await context.updatePagesJSON()
    await setup()
    const pageWatcher = currentPageWatcher(context)!
    const notify = vi.spyOn(context, 'onUpdate')
    parser.mockImplementationOnce(async () => {
      entered.resolve()
      return config.promise
    })

    watcher.emit('change', path.join(root, 'pages.config.json'))
    await entered.promise
    watcher.emit('change', path.join(root, 'pages.config.json'))
    pageWatcher.emit('add', path.join(root, 'src/pages/detail.vue'))
    pageWatcher.emit('add', path.join(root, 'src/pages/other.vue'))
    const closing = context.disposeWatchers()
    config.resolve({ globalStyle: { navigationBarTitleText: 'running update' } })
    await closing

    expect(parser).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
    expectDisposed(context, watcher)
    await setup()
    watcher.emit('ready')
    expect(await context.updatePagesJSON()).toBe(false)
    expect(parser).toHaveBeenCalledTimes(2)
    expectDisposed(context, watcher)
  })

  it('关闭期间初始化失败仍保留原错误，后续注册不能恢复已释放的监听', async () => {
    const entered = gate<void>()
    const config = gate<PagesConfig>()
    const { context, watcher, setup } = fixture(async () => {
      entered.resolve()
      return config.promise
    })
    await setup()
    const failure = new Error('initial config failed')
    const initialization = context.updatePagesJSON()
    const rejected = expect(initialization).rejects.toBe(failure)
    await entered.promise

    const closing = context.disposeWatchers()
    config.reject(failure)
    await rejected
    await closing
    await setup()

    expectDisposed(context, watcher)
  })

  it('重复关闭都等待同一次页面 watcher 释放', async () => {
    const { context, watcher, setup } = fixture(async () => ({}))
    await setup()
    const pageWatcher = currentPageWatcher(context)!
    const released = gate<void>()
    pageWatcher.close.mockImplementationOnce(async () => {
      await released.promise
      pageWatcher.removeAllListeners()
    })

    const first = context.disposeWatchers()
    let closed = false
    const second = context.disposeWatchers().then(() => {
      closed = true
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    try {
      expect(closed).toBe(false)
    }
    finally {
      released.resolve()
    }
    await Promise.all([first, second])
    expect(pageWatcher.close).toHaveBeenCalledOnce()
    expectDisposed(context, watcher)
  })
})
