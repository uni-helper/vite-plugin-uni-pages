import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 监听事件里更新失败不能变成未处理的拒绝。
 *
 * watcher 的回调是 async 函数，没人接它的 Promise。`updatePagesJSON`
 * 在拿不到文件锁或声明文件写不进去时会拒绝（这是它给 `prepare()`
 * 调用方的契约），一旦拒绝从监听回调里漏出去，Node 默认直接终止
 * 进程，正在编辑文件的开发者会看到 dev server 消失。这里把拒绝挡在
 * 回调内、记进 logger。
 */

describe('watcher update failures are logged, not thrown', () => {
  let tmpDir: string
  let ctx: PageContext
  let addHandler: ((path: string) => void) | undefined
  let changeHandler: ((path: string) => void) | undefined

  const watcherStub = {
    add: vi.fn(),
    on: (event: string, handler: (path: string) => void) => {
      if (event === 'add')
        addHandler = handler
      if (event === 'change')
        changeHandler = handler
    },
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-failure-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true })
    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    ctx.setLogger({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), warnOnce: vi.fn(), clearScreen: vi.fn(), hasErrorLogged: vi.fn(() => false), hasWarned: false })
    await ctx.setupWatcher(watcherStub as any)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('logs an add failure instead of leaving an unhandled rejection', async () => {
    const failure = new Error('Failed to acquire the pages.json file lock')
    vi.spyOn(ctx, 'updatePagesJSON').mockRejectedValue(failure)
    const onUpdate = vi.spyOn(ctx, 'onUpdate')

    // 回调自己返回 Promise，调用方既不 await 也不 catch：拒绝必须被消化
    addHandler!(path.join(tmpDir, 'src/pages/new.vue'))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.logger!.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update pages.json after a file change'),
      expect.objectContaining({ error: failure }),
    )
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not log when the update succeeds', async () => {
    vi.mocked(ctx.updatePagesJSON).mockReset()
    vi.mocked(ctx.updatePagesJSON).mockResolvedValue(true)
    vi.mocked(ctx.logger!.error).mockClear()
    const onUpdate = vi.spyOn(ctx, 'onUpdate')

    changeHandler!(path.join(tmpDir, 'src/pages/index.vue'))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.logger!.error).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledOnce()
  })
})
