import type { UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseJSON } from 'comment-json'
import { afterEach, describe, expect, it } from 'vitest'
import { createPages, PageContext, resolveOptions } from '../packages/core/src'

const roots: string[] = []

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-scan-ownership-')))
  roots.push(root)
  return root
}

function page(root: string, filename: string, macro?: string): void {
  const file = path.join(root, filename)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${macro ? `<script setup lang="ts">${macro}</script>` : ''}<template><view /></template>`)
}

function alias(root: string, target: string, link: string): void {
  fs.mkdirSync(path.dirname(path.join(root, link)), { recursive: true })
  fs.symlinkSync(path.join(root, target), path.join(root, link), 'junction')
}

function subPaths(ctx: PageContext, root = 'pkg'): string[] {
  return ctx.subPageMetaData.find(pkg => pkg.root === root)?.pages.map(page => page.path).sort() ?? []
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('扫描目录的 root 意图与页面归属', () => {
  it.each([false, true])('显式 root 优先于同目录默认值，显式声明在前：%s', async (explicitFirst) => {
    const root = fixture()
    page(root, 'src/pkg/pages/index.vue')
    const explicit = { dir: 'src/pkg/pages', root: 'pkg' }
    const subPackages = explicitFirst ? [explicit, 'src/pkg/pages'] : ['src/pkg/pages', explicit]

    const ctx = await createPages({ subPackages }, { root, platform: 'h5' })

    expect(ctx.subPageMetaData).toMatchObject([{ root: 'pkg', pages: [{ path: 'pages/index' }] }])
    expect(subPaths(ctx)).toHaveLength(1)
  })

  it('固定值和回调同属显式 root，相同值合并，回调仍接收词法路径', async () => {
    const root = fixture()
    page(root, 'src/pkg/pages/index.vue')
    const received: string[] = []
    const ctx = await createPages({ subPackages: [
      { dir: 'src/pkg/pages', root: 'pkg' },
      { dir: 'src/pkg/pages', root: (dir) => {
        received.push(dir)
        return 'pkg'
      } },
    ] }, { root })

    expect(received.length).toBeGreaterThan(0)
    expect(received.every(dir => dir === 'src/pkg/pages')).toBe(true)
    expect(subPaths(ctx)).toEqual(['pages/index'])
  })

  it('同物理目录的不同显式 root 报错并定位两个词法来源', () => {
    const root = fixture()
    page(root, 'src/real/index.vue')
    alias(root, 'src/real', 'src/alias')

    expect(() => resolveOptions({ subPackages: [
      { dir: 'src/alias', root: 'first' },
      { dir: 'src/real', root: () => 'second' },
    ] }, root)).toThrow(/Conflicting subpackage roots/)
    try {
      resolveOptions({ subPackages: [
        { dir: 'src/alias', root: 'first' },
        { dir: 'src/real', root: 'second' },
      ] }, root)
    }
    catch (error) {
      expect(String(error)).toContain('src/alias')
      expect(String(error)).toContain('src/real')
      expect(String(error)).toContain('first')
      expect(String(error)).toContain('second')
    }
  })

  it('显式候选决定代表路径，默认别名不提前夺走页面', async () => {
    const root = fixture()
    page(root, 'src/packages/real/pages/index.vue')
    alias(root, 'src/packages/real', 'src/packages/alias')
    const received: string[] = []
    const ctx = await createPages({ subPackages: [
      'src/packages/alias/pages',
      { dir: 'src/packages/real/pages', root: (dir) => {
        received.push(dir)
        return 'packages/real'
      } },
    ] }, { root })

    expect(received.every(dir => dir === 'src/packages/real/pages')).toBe(true)
    expect(ctx.options.subPackages).toContain('src/packages/alias/pages')
    expect(ctx.options.subPackages).toContain('src/packages/real/pages')
    expect(subPaths(ctx, 'packages/real')).toEqual(['pages/index'])
  })

  it('glob 命中 alias 与 real 时保留全部候选并分别求值回调', async () => {
    const root = fixture()
    page(root, 'src/packages/real/pages/index.vue')
    alias(root, 'src/packages/real', 'src/packages/alias')
    const received: string[] = []
    const ctx = await createPages({ subPackages: [{
      dir: 'src/packages/*/pages',
      root: (dir) => {
        received.push(dir)
        return 'packages'
      },
    }] }, { root })

    expect(new Set(received)).toEqual(new Set(['src/packages/alias/pages', 'src/packages/real/pages']))
    expect(ctx.options.subPackages).toEqual(['src/packages/alias/pages', 'src/packages/real/pages'])
    expect(subPaths(ctx, 'packages')).toEqual(['alias/pages/index'])
  })

  it('根外目录的绝对与相对声明只贡献一份页面并保留词法路由基准', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    fs.mkdirSync(root)
    page(workspace, 'external/pages/index.vue')
    const ctx = await createPages({ subPackages: [
      { dir: '../external/pages', root: 'pkg' },
      { dir: path.join(workspace, 'external/pages'), root: 'pkg' },
    ] }, { root })

    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(subPaths(ctx)).toEqual(['../../../external/pages/index'])
  })

  it.each([false, true])('alias 的单文件排除不会丢掉 real 的有效页面，alias 在前：%s', async (aliasFirst) => {
    const root = fixture()
    page(root, 'src/real/foo.vue')
    page(root, 'src/real/bar.vue')
    alias(root, 'src/real', 'src/alias')
    const dirs = aliasFirst ? ['src/alias', 'src/real'] : ['src/real', 'src/alias']
    const ctx = await createPages({
      subPackages: dirs.map(dir => ({ dir, root: 'pkg' })),
      exclude: ['src/alias/foo.vue'],
    }, { root })

    expect(subPaths(ctx)).toHaveLength(2)
    expect(subPaths(ctx)).toContain('../real/foo')
    expect(subPaths(ctx).filter(file => file.endsWith('/bar'))).toHaveLength(1)
  })

  it('显式目录的文件被排除时，默认别名仍沿用已确定的显式 root', async () => {
    const root = fixture()
    page(root, 'src/real/index.vue')
    alias(root, 'src/real', 'src/alias')
    const ctx = await createPages({
      subPackages: [
        'src/alias',
        { dir: 'src/real', root: 'pkg' },
      ],
      exclude: ['src/real/index.vue'],
    }, { root })

    expect(ctx.subPageMetaData).toMatchObject([{ root: 'pkg', pages: [{ path: '../alias/index' }] }])
    expect(subPaths(ctx)).toHaveLength(1)
  })

  it('整个显式目录被排除后不再向默认别名提供 root 意图', async () => {
    const root = fixture()
    page(root, 'src/real/index.vue')
    alias(root, 'src/real', 'src/alias')
    const ctx = await createPages({
      subPackages: ['src/alias', { dir: 'src/real', root: 'pkg' }],
      exclude: ['src/real'],
    }, { root })

    expect(ctx.subPageMetaData).toMatchObject([{ root: 'alias', pages: [{ path: 'index' }] }])
    expect(ctx.subPageMetaData).toHaveLength(1)
  })

  it.each(['static', 'glob', 'callback', 'mixed'] as const)('同 root 的 %s 来源统一聚合', async (kind) => {
    const root = fixture()
    page(root, 'src/parts/first/a.vue', 'definePage({ path: "pkg/a" })')
    page(root, 'src/parts/second/b.vue', 'definePage({ path: "pkg/b" })')
    const subPackages: UserOptions['subPackages'] = kind === 'glob'
      ? [{ dir: 'src/parts/*', root: 'pkg' }]
      : kind === 'callback'
        ? [{ dir: 'src/parts/*', root: () => 'pkg' }]
        : kind === 'mixed'
          ? [{ dir: 'src/parts/first', root: 'pkg' }, { dir: 'src/parts/s*', root: 'pkg' }]
          : [{ dir: 'src/parts/first', root: 'pkg' }, { dir: 'src/parts/second', root: 'pkg' }]
    const ctx = await createPages({ subPackages }, { root })

    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(subPaths(ctx)).toEqual(['a', 'b'])
  })

  it('动态来源零匹配、空目录消失与重新出现均不改变静态聚合', async () => {
    const root = fixture()
    page(root, 'src/first/a.vue', 'definePage({ path: "pkg/a" })')
    page(root, 'src/second/b.vue', 'definePage({ path: "pkg/b" })')
    fs.mkdirSync(path.join(root, 'src/dynamic/empty'), { recursive: true })
    const ctx = await createPages({ subPackages: [
      { dir: 'src/first', root: 'pkg' },
      { dir: 'src/second', root: 'pkg' },
      { dir: 'src/dynamic/*', root: 'pkg' },
    ] }, { root })
    expect(subPaths(ctx)).toEqual(['a', 'b'])

    fs.rmSync(path.join(root, 'src/dynamic/empty'), { recursive: true })
    await ctx.scanAndMerge()
    expect(subPaths(ctx)).toEqual(['a', 'b'])

    page(root, 'src/dynamic/new/c.vue', 'definePage({ path: "pkg/c" })')
    await ctx.scanAndMerge()
    expect(subPaths(ctx)).toEqual(['a', 'b', 'c'])

    fs.rmSync(path.join(root, 'src/dynamic'), { recursive: true })
    await ctx.scanAndMerge()
    expect(subPaths(ctx)).toEqual(['a', 'b'])
  })

  it('父子目录和重复声明按页面身份去重，独有页面保持完整', async () => {
    const root = fixture()
    page(root, 'src/pkg/other.vue')
    page(root, 'src/pkg/pages/index.vue')
    const ctx = await createPages({ subPackages: [
      { dir: 'src/pkg', root: 'pkg' },
      { dir: 'src/pkg/pages', root: 'pkg' },
      { dir: 'src/pkg', root: 'pkg' },
    ] }, { root })

    expect(subPaths(ctx)).toEqual(['other', 'pages/index'])
  })

  it('同页面由两个分包 root 认领时明确报错并定位源文件', async () => {
    const root = fixture()
    page(root, 'src/pkg/pages/index.vue')
    const operation = createPages({ subPackages: [
      { dir: 'src/pkg', root: 'pkg' },
      { dir: 'src/pkg/pages', root: 'nested' },
    ] }, { root })

    await expect(operation).rejects.toThrow(/Conflicting subpackage ownership/)
    await expect(operation).rejects.toThrow(/index\.vue/)
    await expect(operation).rejects.toThrow(/nested/)
  })

  it.each([false, true])('主包与分包重叠时由有效分包优先，别名：%s', async (useAlias) => {
    const root = fixture()
    page(root, 'src/real/index.vue')
    if (useAlias)
      alias(root, 'src/real', 'src/alias')
    const ctx = await createPages({
      dir: 'src/real',
      subPackages: [{ dir: useAlias ? 'src/alias' : 'src/real', root: 'pkg' }],
    }, { root })

    expect(ctx.pageMetaData).toEqual([])
    expect(subPaths(ctx)).toHaveLength(1)
  })

  it('当前平台返回 null 的页面不制造跨分包归属冲突', async () => {
    const root = fixture()
    page(root, 'src/pkg/pages/index.vue', 'definePage(({ platform }) => platform === "h5" ? null : {})')
    const options: UserOptions = { subPackages: [
      { dir: 'src/pkg', root: 'pkg' },
      { dir: 'src/pkg/pages', root: 'nested' },
    ] }

    const ctx = await createPages(options, { root, platform: 'h5' })
    expect(ctx.subPageMetaData).toEqual([])
    await expect(createPages(options, { root, platform: 'mp-weixin' })).rejects.toThrow(/Conflicting subpackage ownership/)
  })

  it('排除和解除整个来源后按当前候选重新聚合', async () => {
    const root = fixture()
    page(root, 'src/first/a.vue', 'definePage({ path: "pkg/a" })')
    page(root, 'src/second/b.vue', 'definePage({ path: "pkg/b" })')
    const exclude = ['src/second']
    const ctx = await createPages({ exclude, subPackages: [
      { dir: 'src/first', root: 'pkg' },
      { dir: 'src/second', root: 'pkg' },
    ] }, { root })
    expect(subPaths(ctx)).toEqual(['a'])

    exclude.splice(0)
    await ctx.scanAndMerge()
    expect(subPaths(ctx)).toEqual(['a', 'b'])

    exclude.push('src/first')
    await ctx.scanAndMerge()
    expect(subPaths(ctx)).toEqual(['b'])
  })

  it('词法路径换指向新目录后重新决议页面身份', async () => {
    const root = fixture()
    page(root, 'src/first/index.vue', 'definePage({ style: { navigationBarTitleText: "first" } })')
    page(root, 'src/second/index.vue', 'definePage({ style: { navigationBarTitleText: "second" } })')
    alias(root, 'src/first', 'src/alias')
    const ctx = await createPages({ subPackages: [{ dir: 'src/alias', root: 'pkg' }] }, { root })
    expect(ctx.subPageMetaData[0].pages[0].style?.navigationBarTitleText).toBe('first')

    fs.unlinkSync(path.join(root, 'src/alias'))
    alias(root, 'src/second', 'src/alias')
    await ctx.scanAndMerge()

    expect(ctx.subPageMetaData[0].pages[0].style?.navigationBarTitleText).toBe('second')
  })
})

describe('生成路由冲突与配置覆盖', () => {
  it.each(['pkg/shared', 'pkg/sub/../shared', 'pkg/./shared/'])('不同来源生成规范完整路由 %s 时报告冲突', async (route) => {
    const root = fixture()
    page(root, 'src/pkg/first.vue', 'definePage({ path: "pkg/shared" })')
    page(root, 'src/pkg/second.vue', `definePage({ path: ${JSON.stringify(route)} })`)
    const operation = createPages({ subPackages: ['src/pkg'] }, { root })

    await expect(operation).rejects.toThrow(/Conflicting generated route.*pkg\/shared/)
    await expect(operation).rejects.toThrow(/first\.vue/)
    await expect(operation).rejects.toThrow(/second\.vue/)
  })

  it('主包与分包用完整路由检查冲突，并保留上次 pages.json', async () => {
    const root = fixture()
    page(root, 'src/pages/main.vue', 'definePage({ path: "pkg/shared" })')
    const ctx = new PageContext({ subPackages: ['src/pkg'], dts: false }, root, 'h5')
    await ctx.updatePagesJSON()
    const previous = fs.readFileSync(ctx.resolvedPagesJSONPath, 'utf8')
    page(root, 'src/pkg/sub.vue', 'definePage({ path: "pkg/./shared/" })')

    await expect(ctx.updatePagesJSON()).rejects.toThrow(/Conflicting generated route.*pkg\/shared/)
    expect(fs.readFileSync(ctx.resolvedPagesJSONPath, 'utf8')).toBe(previous)
  })

  it('配置覆盖不能掩盖扫描来源冲突', async () => {
    const root = fixture()
    page(root, 'src/first/a.vue', 'definePage({ path: "pkg/shared" })')
    page(root, 'src/second/b.vue', 'definePage({ path: "pkg/shared" })')
    const ctx = new PageContext({ subPackages: [
      { dir: 'src/first', root: 'pkg' },
      { dir: 'src/second', root: 'pkg' },
    ] }, root)
    ctx.pagesGlobConfig = { subPackages: [{ root: 'pkg', pages: [{ path: 'shared', style: { navigationBarTitleText: 'override' } }] }] }

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route/)
  })

  it('definePage(null) 不占用生成路由，其他有效来源保持收录', async () => {
    const root = fixture()
    page(root, 'src/pkg/first.vue', 'definePage({ path: "pkg/shared" })')
    page(root, 'src/pkg/second.vue', 'definePage(({ platform }) => platform === "h5" ? null : { path: "pkg/shared" })')

    const ctx = await createPages({ subPackages: ['src/pkg'] }, { root, platform: 'h5' })
    expect(subPaths(ctx)).toEqual(['shared'])
    await expect(createPages({ subPackages: ['src/pkg'] }, { root, platform: 'mp-weixin' })).rejects.toThrow(/Conflicting generated route/)
  })

  it('被当前平台跳过的主包文件后缀不制造路由冲突', async () => {
    const root = fixture()
    page(root, 'src/pages/shared.vue')
    page(root, 'src/pages/other.mp-weixin.vue', 'definePage({ path: "pages/shared.mp-weixin" })')
    const ctx = new PageContext({}, root, 'h5')
    ctx.withUniPlatform = true

    await ctx.updatePagesJSON()

    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['pages/shared'])
  })

  it('真实文件族的格式变体允许合并，分包仍保留原优先级', async () => {
    const root = fixture()
    for (const extension of ['vue', 'nvue', 'uvue'])
      page(root, `src/pkg/shared.${extension}`, `definePage({ style: { navigationBarTitleText: "${extension}" } })`)
    const ctx = await createPages({ subPackages: ['src/pkg'] }, { root })

    expect(subPaths(ctx)).toEqual(['shared'])
    expect(ctx.subPageMetaData[0].pages[0].style?.navigationBarTitleText).toBe('vue')
  })

  it('alias 与 real 交错有效的格式变体按真实来源文件族判断', async () => {
    const root = fixture()
    for (const extension of ['vue', 'nvue', 'uvue'])
      page(root, `src/real/shared.${extension}`, 'definePage({ path: "pages/shared" })')
    alias(root, 'src/real', 'src/alias')
    const ctx = await createPages({ dir: 'src/*', exclude: ['src/alias/shared.vue'] }, { root })

    expect(ctx.pageMetaData).toHaveLength(1)
    expect(ctx.pageMetaData[0].path).toBe('pages/shared')
  })

  it('真实主包平台变体允许覆盖，普通页面不能借元数据平台后缀绕过冲突', async () => {
    const root = fixture()
    page(root, 'src/pages/shared.vue', 'definePage({ style: { navigationBarTitleText: "base" } })')
    page(root, 'src/pages/shared.h5.vue', 'definePage({ style: { navigationBarTitleText: "h5" } })')
    const ctx = new PageContext({ dts: false, homePage: 'pages/shared' }, root, 'h5')
    ctx.withUniPlatform = true
    await ctx.updatePagesJSON()
    expect(ctx.pageMetaData).toMatchObject([{ path: 'pages/shared', style: { navigationBarTitleText: 'h5' } }])

    page(root, 'src/pages/unrelated.vue', 'definePage({ path: "pages/shared.h5" })')
    await expect(ctx.updatePagesJSON()).rejects.toThrow(/Conflicting generated route.*pages\/shared/)
  })

  it('分包不继承主包平台后缀的覆盖例外', async () => {
    const root = fixture()
    page(root, 'src/pkg/shared.vue', 'definePage({ path: "pkg/shared" })')
    page(root, 'src/pkg/shared.h5.vue', 'definePage({ path: "pkg/shared" })')
    const ctx = new PageContext({ subPackages: ['src/pkg'] }, root, 'h5')
    ctx.withUniPlatform = true

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route/)
  })

  it.each([
    ['任意点后缀', 'h5', 'shared.alpha.vue', 'shared.beta.vue'],
    ['不同平台后缀', 'h5', 'shared.h5.vue', 'shared.mp-weixin.vue'],
    ['web 不扩张 h5 文件后缀别名', 'web', 'shared.vue', 'shared.h5.vue'],
  ])('%s 不能用元数据路由伪装当前平台文件族', async (_, platform, first, second) => {
    const root = fixture()
    page(root, `src/pages/${first}`, 'definePage({ path: "pages/shared" })')
    page(root, `src/pages/${second}`, 'definePage({ path: "pages/shared" })')
    const ctx = new PageContext({}, root, platform)
    ctx.withUniPlatform = true

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route.*pages\/shared/)
  })

  it('重命名文件符号链接不能混用词法平台后缀与真实文件族', async () => {
    const root = fixture()
    page(root, 'real/shared.alpha.vue', 'definePage({ path: "pages/shared" })')
    page(root, 'real/shared.beta.vue', 'definePage({ path: "pages/shared" })')
    fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
    fs.symlinkSync(path.join(root, 'real/shared.alpha.vue'), path.join(root, 'src/pages/first.h5.vue'), 'file')
    fs.symlinkSync(path.join(root, 'real/shared.beta.vue'), path.join(root, 'src/pages/second.h5.vue'), 'file')
    const ctx = new PageContext({}, root, 'h5')
    ctx.withUniPlatform = true

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route.*pages\/shared/)
  })

  it('格式文件族例外不允许不同归属占用同一完整路由', async () => {
    const root = fixture()
    page(root, 'src/pages/shared.vue', 'definePage({ path: "pkg/shared" })')
    page(root, 'src/pages/shared.nvue', 'definePage({ path: "pkg/shared" })')
    // 通过不同词法别名分别执行排除，保留双方各自的有效格式
    alias(root, 'src/pages', 'src/pkg-source')
    const ctx = new PageContext({
      subPackages: [{ dir: 'src/pkg-source', root: 'pkg' }],
      exclude: ['src/pages/shared.nvue', 'src/pkg-source/shared.vue'],
    }, root)

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route/)
  })

  it('不同分包分别收录同一真实文件族的两种格式时仍检查完整路由', async () => {
    const root = fixture()
    page(root, 'src/packages/real/shared.vue', 'definePage({ path: "shared" })')
    page(root, 'src/packages/real/shared.nvue', 'definePage({ path: "shared" })')
    alias(root, 'src/packages/real', 'src/alias')
    const ctx = new PageContext({
      subPackages: [
        { dir: 'src/packages', root: 'first' },
        { dir: 'src/alias', root: 'second' },
      ],
      exclude: ['src/packages/real/shared.nvue', 'src/alias/shared.vue'],
    }, root)

    await expect(ctx.scanAndMerge()).rejects.toThrow(/Conflicting generated route.*shared/)
  })

  it('聚合后统一覆盖元数据，并保留其他扫描字段、手工页面、plugins 和配置独有分包', async () => {
    const root = fixture()
    page(root, 'src/first/a.vue', 'definePage({ path: "pkg/a", needLogin: true, style: { navigationBarTitleText: "scanned" } })')
    page(root, 'src/second/b.vue', 'definePage({ path: "pkg/b", style: { navigationBarTitleText: "second" } })')
    const ctx = new PageContext({ subPackages: [
      { dir: 'src/first', root: 'pkg' },
      { dir: 'src/second', root: 'pkg' },
    ] }, root)
    const plugins = { shared: { version: '1.0.0', provider: 'wx123456' } }
    ctx.pagesGlobConfig = { subPackages: [
      { root: 'pkg', pages: [{ path: 'a', style: { navigationBarTitleText: 'user' } }, { path: 'manual' }], plugins },
      { root: 'config-only', pages: [{ path: 'index' }], plugins },
    ] }

    await ctx.scanAndMerge()

    expect(subPaths(ctx)).toEqual(['a', 'b', 'manual'])
    expect(ctx.subPageMetaData.find(pkg => pkg.root === 'pkg')).toMatchObject({
      plugins,
      pages: expect.arrayContaining([
        expect.objectContaining({ path: 'a', needLogin: true, style: { navigationBarTitleText: 'user' } }),
        expect.objectContaining({ path: 'b', style: { navigationBarTitleText: 'second' } }),
      ]),
    })
    expect(ctx.subPageMetaData.find(pkg => pkg.root === 'config-only')).toEqual({ root: 'config-only', pages: [{ path: 'index' }], plugins })
  })

  it('pages.json、虚拟路由和声明文件使用同一组聚合页面', async () => {
    const root = fixture()
    page(root, 'src/first/a.vue', 'definePage({ path: "pkg/a" })')
    page(root, 'src/second/b.vue', 'definePage({ path: "pkg/b" })')
    const declaration = path.join(root, 'pages.d.ts')
    const ctx = new PageContext({ dts: declaration, subPackages: [
      { dir: 'src/first', root: 'pkg' },
      { dir: 'src/second', root: 'pkg' },
    ] }, root, 'h5')
    await ctx.updatePagesJSON()
    const json = parseJSON(fs.readFileSync(ctx.resolvedPagesJSONPath, 'utf8')) as unknown as { subPackages: { root: string, pages: { path: string }[] }[] }
    const routes = JSON.parse(ctx.resolveSubRoutes()) as { root: string, pages: { path: string }[] }[]
    const dts = fs.readFileSync(declaration, 'utf8')

    expect(json.subPackages[0].pages.map(page => page.path).sort()).toEqual(['a', 'b'])
    expect(routes.flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page.path}`)).sort()).toEqual(['pkg/a', 'pkg/b'])
    expect(dts).toContain('"/pkg/a"')
    expect(dts).toContain('"/pkg/b"')
  })
})
