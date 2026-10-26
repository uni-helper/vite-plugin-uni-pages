import { describe, expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

async function setup() {
  const fixture = createFixture('uni-pages-watch-failure-')
  fixture.writeConfig()
  fixture.writePage('src/pages/index.vue')
  const ctx = fixture.context({ dir: 'src/pages', outDir: 'src', dts: false })
  const error = vi.fn()
  ctx.setLogger({ error, warn: vi.fn(), info: vi.fn(), warnOnce: vi.fn(), clearScreen: vi.fn(), hasErrorLogged: vi.fn(() => false), hasWarned: false })
  const watch = await fixture.watch(ctx)
  const onUpdate = vi.spyOn(ctx, 'onUpdate')
  return { ctx, error, onUpdate, fixture, watch }
}

describe('页面更新队列的失败恢复', () => {
  it('记录失败，后续事件仍能完成更新', async () => {
    const { ctx, error, onUpdate, fixture, watch } = await setup()
    const failure = new Error('Failed to acquire the pages.json file lock')
    const update = vi.spyOn(ctx, 'updatePagesJSON').mockRejectedValueOnce(failure).mockResolvedValue(true)

    watch.emit('add', fixture.path('src/pages/new.vue'))
    await watch.settle()

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update pages.json after a file change'),
      expect.objectContaining({ error: failure }),
    )
    expect(onUpdate).not.toHaveBeenCalled()

    watch.emit('change', fixture.path('src/pages/new.vue'))
    await watch.settle()

    expect(update).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('一次更新失败后继续处理同一 flush 中已排队的事件', async () => {
    const { ctx, error, onUpdate, fixture, watch } = await setup()
    const failure = new Error('Failed to write the declarations')
    let rejectUpdate!: (reason: Error) => void
    const pending = new Promise<boolean>((_, reject) => {
      rejectUpdate = reject
    })
    const update = vi.spyOn(ctx, 'updatePagesJSON').mockReturnValueOnce(pending).mockResolvedValue(true)

    watch.emit('add', fixture.path('src/pages/first.vue'))
    watch.emit('add', fixture.path('src/pages/second.vue'))
    rejectUpdate(failure)
    await watch.settle()

    expect(update).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('配置没有变化时不触发更新通知', async () => {
    const { ctx, error, onUpdate, fixture, watch } = await setup()
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)

    watch.emit('change', fixture.path('src/pages/index.vue'))
    await watch.settle()

    expect(error).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
