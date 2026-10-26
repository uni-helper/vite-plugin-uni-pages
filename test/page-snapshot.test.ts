import type { Logger } from 'vite'
import fs from 'node:fs'
import { normalizePath } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { Page } from '../packages/core/src/page'
import { createFixture } from './helpers/fixture'

function fixture(definition?: string) {
  const workspace = createFixture('uni-pages-page-snapshot-')
  workspace.writePage('pages/detail.vue', definition || undefined)
  const file = normalizePath(workspace.path('pages/detail.vue'))
  const logger = { warn: vi.fn() }
  const page = new Page({ platform: 'h5', getLogger: () => logger as unknown as Logger }, {
    relativePath: 'pages/detail',
    absolutePath: file,
  })
  return { page, file, logger, workspace }
}

describe('page 读取快照', () => {
  it('一次读取返回元数据与补全后的 tabBar', async () => {
    const { page } = fixture(`definePage({ style: { navigationBarTitleText: '详情' }, tabBar: { text: '详情页', index: 2 } })`)

    const snapshot = await page.load()

    expect(snapshot.meta).toMatchObject({
      path: 'pages/detail',
      type: 'page',
      style: { navigationBarTitleText: '详情' },
    })
    expect(snapshot.meta).not.toHaveProperty('tabBar')
    expect(snapshot.tabBar).toEqual({ text: '详情页', index: 2, pagePath: 'pages/detail' })
    expect(snapshot.skipped).toBe(false)
    expect(snapshot.changed).toBe(true)
  })

  it('definePage(null) 在快照里标记跳过且不提供 tabBar', async () => {
    const { page } = fixture('definePage(null)')

    const snapshot = await page.load()

    expect(snapshot).toMatchObject({
      meta: { path: 'pages/detail' },
      skipped: true,
      changed: true,
    })
    expect(snapshot.meta).not.toHaveProperty('type')
    expect(snapshot.tabBar).toBeUndefined()
    expect(page.skipped).toBe(true)
  })

  it('缓存失效后只在内容变化时标记 changed', async () => {
    const { page, file } = fixture(`definePage({ style: { navigationBarTitleText: '旧标题' } })`)
    await page.load()

    page.invalidate()
    const unchanged = await page.load()
    expect(unchanged.changed).toBe(false)
    expect(unchanged.meta.style?.navigationBarTitleText).toBe('旧标题')

    fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '新标题' } })</script><template><view /></template>`)
    page.invalidate()
    const changed = await page.load()
    expect(changed.changed).toBe(true)
    expect(changed.meta.style?.navigationBarTitleText).toBe('新标题')
  })

  it('getPageMeta 返回副本，合并阶段的首页标记不会写进读取快照', async () => {
    const { page } = fixture()

    const first = await page.getPageMeta()
    first.type = 'home'
    const second = await page.getPageMeta()

    expect(second.type).toBe('page')
  })

  it('宏失败时保留上次成功快照并告警，修复后可以恢复', async () => {
    const { page, file, logger } = fixture(`definePage({ style: { navigationBarTitleText: '上次成功' } })`)
    const loaded = await page.load()
    expect(loaded.meta.style?.navigationBarTitleText).toBe('上次成功')

    fs.writeFileSync(file, `<script setup>definePage(() => { throw new Error('snapshot failure') })</script><template><view /></template>`)
    page.invalidate()
    const failed = await page.load()
    expect(failed.meta.style?.navigationBarTitleText).toBe('上次成功')
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(String(logger.warn.mock.calls[0]![0])).toContain('snapshot failure')

    fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '恢复' } })</script><template><view /></template>`)
    page.invalidate()
    const recovered = await page.load()
    expect(recovered.meta.style?.navigationBarTitleText).toBe('恢复')
  })
})
