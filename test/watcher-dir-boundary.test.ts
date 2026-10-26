import type { PageContext } from '../packages/core/src'
import type { ControlledPageWatch, TestFixture } from './helpers/fixture'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

describe('watcher matches page files only inside the configured directories', () => {
  let fixture: TestFixture
  let ctx: PageContext
  let watch: ControlledPageWatch

  beforeAll(async () => {
    fixture = createFixture('uni-pages-watch-', { scope: 'file' })
    fixture.writePage('src/pages/index.vue')
    ctx = fixture.context({ dir: 'src/pages', outDir: 'src', dts: false })
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
    watch = await fixture.watch(ctx)
  })

  it('ignores sibling directories sharing the prefix', () => {
    watch.emit('change', fixture.path('src/pages-sub/a.vue'))
    expect(ctx.updatePagesJSON).not.toHaveBeenCalled()
  })

  it('still reacts to files inside the configured directory', async () => {
    watch.emit('change', fixture.path('src/pages/index.vue'))
    await watch.settle()
    expect(ctx.updatePagesJSON).toHaveBeenCalled()
  })
})
