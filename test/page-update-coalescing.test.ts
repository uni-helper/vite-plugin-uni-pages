import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePath } from 'vite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'
import { currentPageWatcher, flushPageUpdates, mockPageWatchers } from './helpers/page-watcher'

const roots: string[] = []
const contexts: PageContext[] = []

beforeEach(() => {
  mockPageWatchers()
})

function page(file: string, title: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} } })</script><template><view /></template>`)
}

function fixture(count: number): { ctx: PageContext, root: string } {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-coalescing-')))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  for (let i = 0; i < count; i++)
    page(path.join(root, `src/pages/p${i}.vue`), `P${i}`)
  const ctx = new PageContext({ dir: 'src/pages', dts: false }, root, 'h5')
  contexts.push(ctx)
  return { ctx, root }
}

async function setup(ctx: PageContext) {
  const shared = Object.assign(new EventEmitter(), { add: vi.fn() })
  await ctx.setupWatcher(shared as unknown as Parameters<PageContext['setupWatcher']>[0])
  return { shared, watcher: currentPageWatcher(ctx)! }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0))
    await ctx.disposeWatchers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

it('连续删除事件合并为有限次生成，读取次数不超过两轮扫描', async () => {
  const { ctx, root } = fixture(30)
  await ctx.updatePagesJSON()
  const { watcher } = await setup(ctx)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const readFile = vi.spyOn(fs.promises, 'readFile')

  for (let i = 0; i < 10; i++) {
    const file = path.join(root, `src/pages/p${i}.vue`)
    fs.unlinkSync(file)
    watcher.emit('unlink', file)
  }
  await flushPageUpdates(ctx)

  expect(updates.mock.calls.length).toBeLessThanOrEqual(2)
  expect(ctx.pageMetaData).toHaveLength(20)
  const pageReads = readFile.mock.calls.filter(call => String(call[0]).endsWith('.vue')).length
  expect(pageReads).toBeGreaterThan(0)
  expect(pageReads).toBeLessThanOrEqual(40)
})

it('一批内多个页面变更仅重读相关页面', async () => {
  const { ctx, root } = fixture(4)
  await ctx.updatePagesJSON()
  const { watcher } = await setup(ctx)
  const onBeforeLoadUserConfig = vi.fn()
  ctx.options.onBeforeLoadUserConfig = onBeforeLoadUserConfig
  const readFile = vi.spyOn(fs.promises, 'readFile')

  for (const index of [0, 1, 2]) {
    page(path.join(root, `src/pages/p${index}.vue`), `更新${index}`)
    watcher.emit('change', path.join(root, `src/pages/p${index}.vue`))
  }
  await flushPageUpdates(ctx)

  expect(onBeforeLoadUserConfig.mock.calls.length).toBeLessThanOrEqual(2)
  expect(readFile.mock.calls.filter(call => call[0] === normalizePath(path.join(root, 'src/pages/p3.vue')))).toHaveLength(0)
  expect(ctx.pageMetaData.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['P3', '更新0', '更新1', '更新2'])
})

it('生成期间到达的内容变更由同一次 flush 继续处理', async () => {
  const { ctx, root } = fixture(3)
  await ctx.updatePagesJSON()
  const { watcher } = await setup(ctx)
  const readFile = vi.spyOn(fs.promises, 'readFile')
  const onBeforeWriteFile = vi.fn().mockImplementationOnce(() => {
    page(path.join(root, 'src/pages/p1.vue'), '后续更新')
    watcher.emit('change', path.join(root, 'src/pages/p1.vue'))
  })
  ctx.options.onBeforeWriteFile = onBeforeWriteFile
  page(path.join(root, 'src/pages/p0.vue'), '首轮更新')

  watcher.emit('change', path.join(root, 'src/pages/p0.vue'))
  await flushPageUpdates(ctx)

  expect(onBeforeWriteFile).toHaveBeenCalledTimes(2)
  expect(ctx.pageMetaData.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['P2', '后续更新', '首轮更新'])
  expect(readFile.mock.calls.filter(call => call[0] === normalizePath(path.join(root, 'src/pages/p2.vue')))).toHaveLength(0)
})

it('页面更新完成后共享 watcher 的重复页面文件事件不再读取或生成', async () => {
  const { ctx, root } = fixture(1)
  await ctx.updatePagesJSON()
  const { shared, watcher } = await setup(ctx)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const readFile = vi.spyOn(fs.promises, 'readFile')
  const file = normalizePath(path.join(root, 'src/pages/p0.vue'))
  page(file, '更新')

  watcher.emit('change', file)
  await flushPageUpdates(ctx)
  expect(ctx.pageMetaData[0].style?.navigationBarTitleText).toBe('更新')
  expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)

  for (const event of ['change', 'add', 'unlink'])
    shared.emit(event, file)
  await flushPageUpdates(ctx)

  expect(updates).toHaveBeenCalledOnce()
  expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)
})
