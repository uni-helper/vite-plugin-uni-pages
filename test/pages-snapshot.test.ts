import type { InternalPages } from '../packages/core/src/types'
import { describe, expect, it } from 'vitest'
import { createPagesSnapshot } from '../packages/core/src/pages-snapshot'
import { createPages, generateAll } from '../packages/core/src/pipeline'
import { createFixture } from './helpers/fixture'

function fixture() {
  const workspace = createFixture('uni-pages-pages-snapshot-')
  workspace.writePage('src/pages/index/index.vue', { type: 'home', tabBar: { text: '首页' } })
  workspace.writePage('src/pkg/pages/detail.vue')
  workspace.writeConfig(`export default { globalStyle: { navigationBarTitleText: '快照' } }`, 'pages.config.ts')
  return workspace
}

describe('pages snapshot', () => {
  it('未写文件时由扫描结果合成快照', async () => {
    const workspace = fixture()
    const ctx = await createPages({ subPackages: [{ dir: 'src/pkg/pages', root: 'pkg' }], dts: false }, { root: workspace.root, platform: 'h5' })

    const snapshot = ctx.snapshot
    expect(snapshot.pages.map(page => page.path)).toEqual(['pages/index/index'])
    expect(snapshot.pages).not.toBe(ctx.pageMetaData)
    expect(snapshot.subPackages).toMatchObject([{ root: 'pkg', pages: [{ path: 'pages/detail' }] }])
    expect(ctx.resolveRoutes()).toContain('pages/index/index')
    expect(ctx.virtualModule()).toContain('pages/index/index')
  })

  it('生成后快照包含配置、首页与 tabBar，虚拟模块读取同一份结果', async () => {
    const workspace = fixture()
    const { ctx, updated } = await generateAll({ subPackages: [{ dir: 'src/pkg/pages', root: 'pkg' }], dts: false }, { root: workspace.root, platform: 'h5' })

    expect(updated).toBe(true)
    const snapshot = ctx.snapshot
    expect(snapshot.homePath).toBe('pages/index/index')
    expect(snapshot.globConfig?.globalStyle?.navigationBarTitleText).toBe('快照')
    expect(snapshot.tabBar?.list).toMatchObject([{ pagePath: 'pages/index/index', text: '首页' }])
    expect(ctx.resolveRoutes()).toBe(JSON.stringify(snapshot.pages, null, 2))
    expect(ctx.resolveSubRoutes()).toBe(JSON.stringify(snapshot.subPackages, null, 2))
  })

  it('创建快照时复制容器，后续工作字段增删不改变已取出的结果', () => {
    const pages: InternalPages = [{ path: 'pages/index' }]
    const subPackages = [{ root: 'pkg', pages: [{ path: 'detail' }] }]
    const tabBar = { list: [{ pagePath: 'pages/index', text: '首页' }] }
    const snapshot = createPagesSnapshot({ pages, subPackages, tabBar, homePath: 'pages/index' })

    pages.push({ path: 'pages/later' })
    subPackages.push({ root: 'later', pages: [] })
    tabBar.list.push({ pagePath: 'pages/later', text: '后加' })

    expect(snapshot.pages.map(page => page.path)).toEqual(['pages/index'])
    expect(snapshot.subPackages.map(pkg => pkg.root)).toEqual(['pkg'])
    expect(snapshot.tabBar?.list).toHaveLength(1)
  })
})
