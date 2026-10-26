import fs from 'node:fs'
import { normalizePath } from 'vite'
import { expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

async function setup(count: number) {
  const fixture = createFixture('uni-pages-coalescing-')
  fixture.writeConfig()
  for (let i = 0; i < count; i++)
    fixture.writePage(`src/pages/p${i}.vue`, { style: { navigationBarTitleText: `P${i}` } })
  const ctx = fixture.context({ dir: 'src/pages', dts: false })
  await ctx.updatePagesJSON()
  const watch = await fixture.watch(ctx)
  return { fixture, ctx, watch }
}

function pagePath(fixture: ReturnType<typeof createFixture>, name: string): string {
  return normalizePath(fixture.path(`src/pages/${name}.vue`))
}

it('连续删除事件合并为有限次生成，读取次数不超过两轮扫描', async () => {
  const { fixture, ctx, watch } = await setup(30)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const readFile = vi.spyOn(fs.promises, 'readFile')

  for (let i = 0; i < 10; i++) {
    const file = fixture.path(`src/pages/p${i}.vue`)
    fs.unlinkSync(file)
    watch.emit('unlink', file)
  }
  await watch.settle()

  expect(updates.mock.calls.length).toBeLessThanOrEqual(2)
  expect(ctx.pageMetaData).toHaveLength(20)
  const pageReads = readFile.mock.calls.filter(call => String(call[0]).endsWith('.vue')).length
  expect(pageReads).toBeGreaterThan(0)
  expect(pageReads).toBeLessThanOrEqual(40)
})

it('一批内多个页面变更仅重读相关页面', async () => {
  const { fixture, ctx, watch } = await setup(4)
  const onBeforeLoadUserConfig = vi.fn()
  ctx.options.onBeforeLoadUserConfig = onBeforeLoadUserConfig
  const readFile = vi.spyOn(fs.promises, 'readFile')

  for (const index of [0, 1, 2]) {
    fixture.writePage(`src/pages/p${index}.vue`, { style: { navigationBarTitleText: `更新${index}` } })
    watch.emit('change', fixture.path(`src/pages/p${index}.vue`))
  }
  await watch.settle()

  expect(onBeforeLoadUserConfig.mock.calls.length).toBeLessThanOrEqual(2)
  expect(readFile.mock.calls.filter(call => call[0] === pagePath(fixture, 'p3'))).toHaveLength(0)
  expect(ctx.pageMetaData.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['P3', '更新0', '更新1', '更新2'])
})

it('生成期间到达的内容变更由同一次 flush 继续处理', async () => {
  const { fixture, ctx, watch } = await setup(3)
  const readFile = vi.spyOn(fs.promises, 'readFile')
  const onBeforeWriteFile = vi.fn().mockImplementationOnce(() => {
    fixture.writePage('src/pages/p1.vue', { style: { navigationBarTitleText: '后续更新' } })
    watch.emit('change', fixture.path('src/pages/p1.vue'))
  })
  ctx.options.onBeforeWriteFile = onBeforeWriteFile
  fixture.writePage('src/pages/p0.vue', { style: { navigationBarTitleText: '首轮更新' } })

  watch.emit('change', fixture.path('src/pages/p0.vue'))
  await watch.settle()

  expect(onBeforeWriteFile).toHaveBeenCalledTimes(2)
  expect(ctx.pageMetaData.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['P2', '后续更新', '首轮更新'])
  expect(readFile.mock.calls.filter(call => call[0] === pagePath(fixture, 'p2'))).toHaveLength(0)
})

it('页面更新完成后共享 watcher 的重复页面文件事件不再读取或生成', async () => {
  const { fixture, ctx, watch } = await setup(1)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const readFile = vi.spyOn(fs.promises, 'readFile')
  const file = pagePath(fixture, 'p0')
  fixture.writePage('src/pages/p0.vue', { style: { navigationBarTitleText: '更新' } })

  watch.emit('change', file)
  await watch.settle()
  expect(ctx.pageMetaData[0].style?.navigationBarTitleText).toBe('更新')
  expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)

  for (const event of ['change', 'add', 'unlink'])
    watch.shared.emit(event, file)
  await watch.settle()

  expect(updates).toHaveBeenCalledOnce()
  expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)
})
