import fs from 'node:fs'
import { normalizePath } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

describe('页面监听启动恢复', () => {
  it('启动失败后共享 watcher 的页面事件会重试并恢复更新', async () => {
    const fixture = createFixture('uni-pages-watcher-recovery-')
    fixture.write('package.json', '{"type":"module"}')
    fixture.writePage('src/pages/index.vue', { style: { navigationBarTitleText: 'index' } })
    const pageRoot = normalizePath(fixture.path('src/pages'))
    const read = fs.readdirSync
    vi.spyOn(fs, 'readdirSync').mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (normalizePath(String(file)) === pageRoot)
        throw Object.assign(new Error('I/O error'), { code: 'EIO' })
      return Reflect.apply(read, fs, [file, options])
    }) as typeof fs.readdirSync)

    const ctx = fixture.context({ dir: 'src/pages', dts: false })
    await ctx.updatePagesJSON()
    const watch = await fixture.watch(ctx)
    expect(watch.state().started).toBe(false)

    vi.mocked(fs.readdirSync).mockRestore()
    fixture.writePage('src/pages/detail.vue', { style: { navigationBarTitleText: 'detail' } })
    watch.shared.emit('change', fixture.path('src/pages/detail.vue'))
    await watch.settle()

    expect(watch.state().started).toBe(true)
    expect(ctx.pageMetaData.map(meta => meta.path).sort()).toEqual(['pages/detail', 'pages/index'])
  })
})
