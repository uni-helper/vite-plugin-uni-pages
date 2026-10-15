import type { UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPages, resolveOptions } from '../packages/core/src'

const roots: string[] = []
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-glob-'))
  roots.push(root)
  return root
}
function page(root: string, name: string): void {
  const target = path.join(root, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '<template><view /></template>')
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

const subPackages: UserOptions['subPackages'] = [{
  dir: 'src/packages/*/pages',
  root: dir => path.posix.relative('src', path.posix.dirname(dir)),
}]

describe('分包 glob', () => {
  it('按路径排序展开字符串规则，页面路径相对匹配目录', async () => {
    const root = fixture()
    page(root, 'src/packages/z/pages/detail.vue')
    page(root, 'src/packages/a/pages/detail.vue')
    const ctx = await createPages({ subPackages: ['src/packages/*/pages'] }, { root })
    expect(ctx.subPageMetaData.map(pkg => ({ root: pkg.root, paths: pkg.pages.map(page => page.path) }))).toEqual([
      { root: 'packages/a/pages', paths: ['detail'] },
      { root: 'packages/z/pages', paths: ['detail'] },
    ])
  })

  it('root 回调收到相对项目根的目录，并保留祖先到页面间的路径', async () => {
    const root = fixture()
    const received: string[] = []
    page(root, 'src/packages/account/pages/profile.vue')
    const ctx = await createPages({
      subPackages: [{
        dir: path.join(root, 'src/packages/*/pages'),
        root: (dir) => {
          received.push(dir)
          return path.posix.relative('src', path.posix.dirname(dir))
        },
      }],
    }, { root })
    expect(received.every(dir => dir === 'src/packages/account/pages')).toBe(true)
    expect(ctx.subPageMetaData[0]).toMatchObject({ root: 'packages/account', pages: [{ path: 'pages/profile' }] })
  })

  it('主包和分包目录在零匹配后重新发现，并在删除后移除', async () => {
    const root = fixture()
    const ctx = await createPages({ dir: 'src/*/main', subPackages }, { root })
    expect(ctx.pageMetaData).toEqual([])
    expect(ctx.subPageMetaData).toEqual([])
    page(root, 'src/new/main/index.vue')
    page(root, 'src/packages/account/pages/profile.vue')
    await ctx.scanAndMerge()
    expect(ctx.pageMetaData[0].path).toBe('new/main/index')
    expect(ctx.subPageMetaData[0].root).toBe('packages/account')
    fs.rmSync(path.join(root, 'src/packages/account'), { recursive: true })
    await ctx.scanAndMerge()
    expect(ctx.subPageMetaData).toEqual([])
  })

  it('重复的物理目录与 root 去重，冲突的 root 报错', async () => {
    const root = fixture()
    page(root, 'src/packages/account/pages/profile.vue')
    const ctx = await createPages({ subPackages: [...subPackages!, ...subPackages!] }, { root })
    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(ctx.subPageMetaData[0].pages).toHaveLength(1)
    expect(() => resolveOptions({ subPackages: [...subPackages!, { dir: 'src/packages/account/pages', root: 'conflict' }] }, root)).toThrow('Conflicting subpackage roots')
    // 纯静态规则之间也要报错：否则 root 由声明顺序决定，写错时静默生效
    expect(() => resolveOptions({
      subPackages: [
        { dir: 'src/packages/account/pages', root: 'first' },
        { dir: 'src/packages/account/pages', root: 'second' },
      ],
    }, root)).toThrow('Conflicting subpackage roots')
    expect(resolveOptions({ subPackages: [{ dir: 'src/packages/account/pages', root: 'same' }, { dir: 'src/packages/account/pages', root: 'same' }] }, root).subPackages).toEqual(['src/packages/account/pages'])
  })

  it('多个动态目录使用同一 root 时合并页面', async () => {
    const root = fixture()
    page(root, 'src/packages/account/pages/profile.vue')
    page(root, 'src/packages/order/pages/list.vue')
    const ctx = await createPages({ subPackages: [{ dir: 'src/packages/*/pages', root: 'packages' }] }, { root })
    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(ctx.subPageMetaData[0].pages.map(page => page.path)).toEqual(['account/pages/profile', 'order/pages/list'])
    ctx.pagesGlobConfig = { subPackages: [{ root: 'packages', pages: [{ path: 'account/pages/profile', style: { navigationBarTitleText: '覆盖标题' } }], plugins: { demo: { version: '1', provider: 'demo' } } }] }
    await ctx.scanAndMerge()
    expect(ctx.subPageMetaData[0].pages).toHaveLength(2)
    expect(ctx.subPageMetaData[0].pages[0].style?.navigationBarTitleText).toBe('覆盖标题')
    expect(ctx.subPageMetaData[0].plugins).toEqual({ demo: { version: '1', provider: 'demo' } })
  })

  it('否定规则提供明确的 exclude 指引', () => {
    const root = fixture()
    expect(() => resolveOptions({ subPackages: ['!src/packages/hidden'] }, root)).toThrow('Use exclude')
  })

  it('glob 排除项同时约束目录发现和页面扫描', async () => {
    const root = fixture()
    page(root, 'src/packages/account/pages/profile.vue')
    page(root, 'src/packages/hidden/pages/detail.vue')
    page(root, 'src/packages/account/pages/__private__/detail.vue')
    const ctx = await createPages({ subPackages, exclude: ['**/hidden/**', '**/__*__/**'] }, { root })
    expect(ctx.subPageMetaData.map(pkg => pkg.root)).toEqual(['packages/account'])
    expect(ctx.subPageMetaData[0].pages.map(page => page.path)).toEqual(['pages/profile'])
  })

  it('发现项目根以外的目录，保留已有默认 root 算法', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    fs.mkdirSync(root)
    page(workspace, 'shared/account/pages/profile.vue')
    const ctx = await createPages({ subPackages: ['../shared/*/pages'] }, { root })
    expect(ctx.subPageMetaData[0]).toMatchObject({ root: '../../shared/account/pages', pages: [{ path: 'profile' }] })
  })

  it.each(['', '.', '../account', '/account', 'C:\\account'])('拒绝 root 回调返回无效路径 %s', (invalid) => {
    const root = fixture()
    page(root, 'src/packages/account/pages/profile.vue')
    expect(() => resolveOptions({ subPackages: [{ dir: 'src/packages/*/pages', root: () => invalid }] }, root)).toThrow('Invalid subpackage root')
  })
})
