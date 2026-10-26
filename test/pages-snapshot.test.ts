import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPages, generateAll } from '../packages/core/src/pipeline'

const roots: string[] = []

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-pages-snapshot-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages/index'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src/pkg/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index/index.vue'), `<script setup>definePage({ type: 'home', tabBar: { text: '首页' } })</script><template><view /></template>`)
  fs.writeFileSync(path.join(root, 'src/pkg/pages/detail.vue'), '<template><view /></template>')
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default { globalStyle: { navigationBarTitleText: '快照' } }`)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('pages snapshot', () => {
  it('未写文件时由扫描结果合成快照', async () => {
    const root = fixture()
    const ctx = await createPages({ subPackages: [{ dir: 'src/pkg/pages', root: 'pkg' }], dts: false }, { root, platform: 'h5' })

    const snapshot = ctx.snapshot
    expect(snapshot.pages.map(page => page.path)).toEqual(['pages/index/index'])
    expect(snapshot.subPackages).toMatchObject([{ root: 'pkg', pages: [{ path: 'pages/detail' }] }])
    expect(ctx.resolveRoutes()).toContain('pages/index/index')
    expect(ctx.virtualModule()).toContain('pages/index/index')
  })

  it('生成后快照包含配置、首页与 tabBar，虚拟模块读取同一份结果', async () => {
    const root = fixture()
    const { ctx, updated } = await generateAll({ subPackages: [{ dir: 'src/pkg/pages', root: 'pkg' }], dts: false }, { root, platform: 'h5' })

    expect(updated).toBe(true)
    const snapshot = ctx.snapshot
    expect(snapshot.homePath).toBe('pages/index/index')
    expect(snapshot.globConfig?.globalStyle?.navigationBarTitleText).toBe('快照')
    expect(snapshot.tabBar?.list).toMatchObject([{ pagePath: 'pages/index/index', text: '首页' }])
    expect(ctx.resolveRoutes()).toBe(JSON.stringify(snapshot.pages, null, 2))
    expect(ctx.resolveSubRoutes()).toBe(JSON.stringify(snapshot.subPackages, null, 2))
  })
})
