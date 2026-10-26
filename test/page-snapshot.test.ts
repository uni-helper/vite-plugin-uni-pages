import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Page } from '../packages/core/src/page'

const roots: string[] = []

function fixture(definition = ''): { page: Page, file: string, logger: { warn: ReturnType<typeof vi.fn> } } {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-page-snapshot-')))
  roots.push(root)
  const file = normalizePath(path.join(root, 'pages/detail.vue'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>${definition}</script><template><view /></template>`)
  const logger = { warn: vi.fn() }
  const page = new Page({ platform: 'h5', logger: logger as any }, {
    relativePath: 'pages/detail',
    absolutePath: file,
  })
  return { page, file, logger }
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

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

  it('宏失败时保留上次快照并告警，修复后可以恢复', async () => {
    const { page, file, logger } = fixture(`definePage(() => { throw new Error('snapshot failure') })`)

    const failed = await page.load()
    expect(failed.meta).toEqual({ path: 'pages/detail' })
    expect(failed.changed).toBe(true)
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(String(logger.warn.mock.calls[0]![0])).toContain('snapshot failure')

    fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '恢复' } })</script><template><view /></template>`)
    page.invalidate()
    const recovered = await page.load()
    expect(recovered.meta.style?.navigationBarTitleText).toBe('恢复')
  })
})
