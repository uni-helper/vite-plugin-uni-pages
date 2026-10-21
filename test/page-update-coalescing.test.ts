import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const roots: string[] = []
const contexts: PageContext[] = []

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

async function setup(ctx: PageContext): Promise<EventEmitter> {
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  return watcher
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
  const watcher = await setup(ctx)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const readFile = vi.spyOn(fs.promises, 'readFile')

  for (let i = 0; i < 10; i++) {
    const file = path.join(root, `src/pages/p${i}.vue`)
    fs.unlinkSync(file)
    watcher.emit('unlink', file)
  }
  await ctx.disposeWatchers()

  expect(updates.mock.calls.length).toBeLessThanOrEqual(2)
  expect(ctx.pageMetaData).toHaveLength(20)
  const pageReads = readFile.mock.calls.filter(call => String(call[0]).endsWith('.vue')).length
  expect(pageReads).toBeGreaterThan(0)
  expect(pageReads).toBeLessThanOrEqual(40)
})

it('一批内多个页面变更合并为一次全量生成', async () => {
  const { ctx, root } = fixture(4)
  await ctx.updatePagesJSON()
  const watcher = await setup(ctx)
  const updates = vi.spyOn(ctx, 'updatePagesJSON')

  for (const index of [0, 1, 2]) {
    page(path.join(root, `src/pages/p${index}.vue`), `更新${index}`)
    watcher.emit('change', path.join(root, `src/pages/p${index}.vue`))
  }
  await ctx.disposeWatchers()

  expect(updates.mock.calls.length).toBeLessThanOrEqual(2)
  expect(ctx.pageMetaData.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['P3', '更新0', '更新1', '更新2'])
})
