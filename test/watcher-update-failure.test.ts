import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const roots: string[] = []
const contexts: PageContext[] = []

async function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-failure-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  const ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, root, 'h5')
  contexts.push(ctx)
  const error = vi.fn()
  ctx.setLogger({ error, warn: vi.fn(), info: vi.fn(), warnOnce: vi.fn(), clearScreen: vi.fn(), hasErrorLogged: vi.fn(() => false), hasWarned: false })
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  const onUpdate = vi.spyOn(ctx, 'onUpdate')
  return { ctx, error, onUpdate, root, watcher }
}

async function flush(ctx: PageContext): Promise<void> {
  await (ctx as unknown as { pendingPageFlush?: Promise<void> }).pendingPageFlush
}

afterEach(async () => {
  for (const ctx of contexts.splice(0))
    await ctx.disposeWatchers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('页面更新队列的失败恢复', () => {
  it('记录失败，后续事件仍能完成更新', async () => {
    const { ctx, error, onUpdate, root, watcher } = await fixture()
    const failure = new Error('Failed to acquire the pages.json file lock')
    const update = vi.spyOn(ctx, 'updatePagesJSON').mockRejectedValueOnce(failure).mockResolvedValue(true)

    watcher.emit('add', path.join(root, 'src/pages/new.vue'))
    await flush(ctx)

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update pages.json after a file change'),
      expect.objectContaining({ error: failure }),
    )
    expect(onUpdate).not.toHaveBeenCalled()

    watcher.emit('change', path.join(root, 'src/pages/new.vue'))
    await flush(ctx)

    expect(update).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('一次更新失败后继续处理同一 flush 中已排队的事件', async () => {
    const { ctx, error, onUpdate, root, watcher } = await fixture()
    const failure = new Error('Failed to write the declarations')
    let rejectUpdate!: (reason: Error) => void
    const pending = new Promise<boolean>((_, reject) => {
      rejectUpdate = reject
    })
    const update = vi.spyOn(ctx, 'updatePagesJSON').mockReturnValueOnce(pending).mockResolvedValue(true)

    watcher.emit('add', path.join(root, 'src/pages/first.vue'))
    watcher.emit('add', path.join(root, 'src/pages/second.vue'))
    rejectUpdate(failure)
    await flush(ctx)

    expect(update).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('配置没有变化时不触发更新通知', async () => {
    const { ctx, error, onUpdate, root, watcher } = await fixture()
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)

    watcher.emit('change', path.join(root, 'src/pages/index.vue'))
    await flush(ctx)

    expect(error).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
