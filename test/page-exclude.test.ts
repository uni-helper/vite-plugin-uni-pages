import type { UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPages, getPageFiles, isPageDirectoryEvent, isPageFileInDirectories, resolveOptions } from '../packages/core/src'

const roots: string[] = []

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-exclude-'))
  roots.push(root)
  return root
}

function page(root: string, name: string): string {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '<template><view /></template>')
  return file
}

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('页面排除规则', () => {
  it('扫描和页面事件统一按项目根解释相对文件规则', async () => {
    const root = fixture()
    const excluded = page(root, 'src/pages/index.vue')
    const included = page(root, 'src/pages/detail.vue')
    const ctx = await createPages({ exclude: ['src/pages/index.vue'] }, { root })

    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['pages/detail'])
    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['detail.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })

  it('文件名规则只作用于项目根，不重新相对各个扫描目录匹配', async () => {
    const root = fixture()
    const main = page(root, 'src/pages/index.vue')
    const sub = page(root, 'src/packages/account/pages/index.vue')
    const ctx = await createPages({ subPackages: ['src/packages/account/pages'], exclude: ['index.vue'] }, { root })

    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['pages/index'])
    expect(ctx.subPageMetaData[0].pages.map(page => page.path)).toEqual(['index'])
    expect(isPageFileInDirectories(main, ctx.options)).toBe(true)
    expect(isPageFileInDirectories(sub, ctx.options)).toBe(true)
  })

  it.each(['相对', '绝对'] as const)('%s文件规则保留 getPageFiles 相对扫描目录的返回值', async (kind) => {
    const root = fixture()
    const excluded = page(root, 'src/pages/nested/index.vue')
    page(root, 'src/pages/nested/detail.nvue')
    const exclude = kind === '绝对' ? normalizePath(excluded) : 'src/pages/nested/index.vue'
    const ctx = await createPages({ dir: normalizePath(path.join(root, 'src/pages')), exclude: [exclude] }, { root })

    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['pages/nested/detail'])
    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['nested/detail.nvue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
  })

  it.each(['src/pages/private', 'src/pages/private/**'])('目录规则 %s 同时排除自身和子树，并保留相邻前缀', async (exclude) => {
    const root = fixture()
    const excluded = page(root, 'src/pages/private/nested/index.vue')
    const included = page(root, 'src/pages/private-other/index.vue')
    const ctx = await createPages({ exclude: [exclude] }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['private-other/index.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.join(root, 'src/pages/private'), ctx.options)).toBe(false)
  })

  it('主包 glob 的目录发现与文件事件使用同一排除规则', async () => {
    const root = fixture()
    const excluded = page(root, 'src/private/pages/index.vue')
    page(root, 'src/public/pages/index.vue')
    const ctx = await createPages({ dir: 'src/*/pages', exclude: ['src/private'] }, { root })

    expect(ctx.options.dirs.map(dir => normalizePath(path.resolve(root, dir)))).toEqual([normalizePath(path.join(root, 'src/public/pages'))])
    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['public/pages/index'])
    expect(isPageDirectoryEvent(path.join(root, 'src/private/pages'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(path.join(root, 'src/future/pages/index.vue'), ctx.options)).toBe(true)
  })

  const packageDeclarations: { name: string, subPackages: NonNullable<UserOptions['subPackages']> }[] = [
    { name: '字面目录', subPackages: ['src/packages/private/pages', 'src/packages/public/pages'] },
    { name: '固定 root', subPackages: [{ dir: 'src/packages/private/pages', root: 'private' }, { dir: 'src/packages/public/pages', root: 'public' }] },
    { name: '回调 root', subPackages: [{ dir: 'src/packages/private/pages', root: () => 'private' }, { dir: 'src/packages/public/pages', root: () => 'public' }] },
    { name: 'glob 目录', subPackages: ['src/packages/*/pages'] },
    { name: 'glob 与固定 root', subPackages: [{ dir: 'src/packages/*/pages', root: 'packages' }] },
    { name: 'glob 与回调 root', subPackages: [{ dir: 'src/packages/*/pages', root: dir => path.posix.basename(path.posix.dirname(dir)) }] },
  ]

  it.each(packageDeclarations)('$name 不绕过祖先目录排除', async ({ subPackages }) => {
    const root = fixture()
    const excluded = page(root, 'src/packages/private/pages/index.vue')
    const included = page(root, 'src/packages/public/pages/index.vue')
    const ctx = await createPages({ subPackages, exclude: ['src/packages/private'] }, { root })

    expect(ctx.options.subPackages).toEqual(['src/packages/public/pages'])
    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(ctx.subPageMetaData[0].pages).toHaveLength(1)
    expect(getPageFiles(path.join(root, 'src/packages/private/pages'), ctx.options)).toEqual([])
    expect(isPageDirectoryEvent(path.join(root, 'src/packages/private'), ctx.options)).toBe(false)
    expect(isPageDirectoryEvent(path.join(root, 'src/packages/private/pages'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })

  it('输出目录、分包 root 和后续 cwd 变化不改变排除基准', async () => {
    const root = fixture()
    const unrelated = fixture()
    const excluded = page(root, 'src/packages/account/pages/index.vue')
    page(root, 'src/packages/account/pages/detail.vue')
    const ctx = await createPages({
      outDir: '.',
      subPackages: [{ dir: 'src/packages/*/pages', root: () => 'account' }],
      exclude: ['src/packages/account/pages/index.vue'],
    }, { root })
    vi.spyOn(process, 'cwd').mockReturnValue(unrelated)

    expect(ctx.subPageMetaData[0].pages).toHaveLength(1)
    expect(getPageFiles(path.join(root, 'src/packages/account/pages'), ctx.options)).toEqual(['detail.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories('src/packages/account/pages/detail.vue', ctx.options)).toBe(true)
  })

  it('相对 Vite root 在解析时固定为绝对路径', () => {
    const root = fixture()
    page(root, 'src/pages/index.vue')
    const options = resolveOptions({ exclude: ['src/pages/index.vue'] }, path.relative(process.cwd(), root))
    vi.spyOn(process, 'cwd').mockReturnValue(fixture())

    expect(normalizePath(options.root)).toBe(normalizePath(root))
    expect(getPageFiles(path.join(root, 'src/pages'), options)).toEqual([])
    expect(isPageFileInDirectories('src/pages/index.vue', options)).toBe(false)
  })

  it.each([
    { exclude: '**/index.vue', local: false, external: ['index.vue', 'keep.vue', 'nested/index.vue'] },
    { exclude: '../shared/pages/**/index.vue', local: true, external: ['keep.vue'] },
  ])('根外目录按显式前缀解释 $exclude', async ({ exclude, local, external }) => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const localFile = page(root, 'src/pages/index.vue')
    const externalFile = page(workspace, 'shared/pages/index.vue')
    page(workspace, 'shared/pages/nested/index.vue')
    page(workspace, 'shared/pages/keep.vue')
    const ctx = await createPages({ subPackages: ['../shared/pages'], exclude: [exclude] }, { root })

    expect(ctx.pageMetaData).toHaveLength(local ? 1 : 0)
    expect(getPageFiles(path.join(workspace, 'shared/pages'), ctx.options).sort()).toEqual(external)
    expect(isPageFileInDirectories(localFile, ctx.options)).toBe(local)
    expect(isPageFileInDirectories(externalFile, ctx.options)).toBe(external.includes('index.vue'))
  })

  it('绝对规则可以排除项目根外的目录子树', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    page(root, 'src/pages/index.vue')
    const excluded = page(workspace, 'shared/private/pages/index.vue')
    const included = page(workspace, 'shared/public/pages/index.vue')
    const ctx = await createPages({
      subPackages: ['../shared/*/pages'],
      exclude: [normalizePath(path.join(workspace, 'shared/private'))],
    }, { root })

    expect(ctx.options.subPackages).toEqual(['../shared/public/pages'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.dirname(excluded), ctx.options)).toBe(false)
  })

  it('绝对文件系统根规则保留根分隔符并排除其子树', () => {
    const root = fixture()
    const excluded = page(root, 'src/pages/index.vue')
    const options = resolveOptions({ exclude: [normalizePath(path.parse(root).root)] }, root)

    expect(getPageFiles(path.join(root, 'src/pages'), options)).toEqual([])
    expect(isPageFileInDirectories(excluded, options)).toBe(false)
  })

  it('排除项目根只影响实际子树，不沿相对路径中的 .. 误伤兄弟目录', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const excluded = page(root, 'src/pages/index.vue')
    const included = page(workspace, 'shared/pages/index.vue')
    const ctx = await createPages({ subPackages: ['../shared/pages'], exclude: ['.'] }, { root })

    expect(ctx.pageMetaData).toEqual([])
    expect(ctx.subPageMetaData[0].pages).toHaveLength(1)
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(root, ctx.options)).toBe(false)
  })

  it('删除后和目录尚未出现时也能按同一规则判断事件', async () => {
    const root = fixture()
    const excluded = page(root, 'src/packages/private/pages/index.vue')
    const included = page(root, 'src/packages/public/pages/index.vue')
    const ctx = await createPages({ subPackages: ['src/packages/*/pages'], exclude: ['src/packages/private'] }, { root })
    fs.rmSync(path.join(root, 'src/packages'), { recursive: true })

    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageDirectoryEvent(path.dirname(excluded), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.dirname(included), ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.join(root, 'src/packages'), ctx.options)).toBe(true)
    expect(isPageFileInDirectories(path.join(root, 'src/packages/future/pages/index.vue'), ctx.options)).toBe(true)
    await ctx.scanAndMerge()
    expect(ctx.subPageMetaData).toEqual([])
  })

  it('补扫发现新目录时继续应用已有排除规则', async () => {
    const root = fixture()
    const ctx = await createPages({ subPackages: ['src/packages/*/pages'], exclude: ['src/packages/private'] }, { root })
    page(root, 'src/packages/private/pages/index.vue')
    page(root, 'src/packages/public/pages/index.vue')
    await ctx.scanAndMerge()

    expect(ctx.options.subPackages).toEqual(['src/packages/public/pages'])
    expect(ctx.subPageMetaData).toHaveLength(1)
  })

  it.each([
    { name: '默认规则', exclude: undefined, included: false },
    { name: '空数组', exclude: [], included: true },
    { name: '自定义规则', exclude: ['unrelated'], included: true },
  ])('$name 决定是否排除各层默认目录', async ({ exclude, included }) => {
    const root = fixture()
    const files = [
      page(root, 'src/pages/node_modules/vendor/index.vue'),
      page(root, 'src/pages/nested/node_modules/vendor/index.vue'),
      page(root, 'src/pages/__private__/index.vue'),
    ]
    page(root, 'src/pages/keep.vue')
    const ctx = await createPages({ exclude }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options).sort()).toEqual(included
      ? ['__private__/index.vue', 'keep.vue', 'nested/node_modules/vendor/index.vue', 'node_modules/vendor/index.vue']
      : ['keep.vue'])
    for (const file of files)
      expect(isPageFileInDirectories(file, ctx.options)).toBe(included)
  })

  it('默认规则不隐式覆盖根外来源', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    fs.mkdirSync(root)
    const included = page(workspace, 'shared/pages/node_modules/vendor/index.vue')
    const ctx = await createPages({ subPackages: ['../shared/pages'] }, { root })

    expect(ctx.subPageMetaData[0].pages).toHaveLength(1)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })

  it('宽扫描在读取目录前剪除默认排除的依赖和私有子树', () => {
    const root = fixture()
    const excludedDirectories = ['node_modules', '__private__', 'nested/node_modules', 'nested/__private__']
    for (const directory of excludedDirectories)
      page(root, `${directory}/deep/index.vue`)
    page(root, 'keep.vue')
    page(root, 'nested/keep.vue')
    const options = resolveOptions({ dir: '.' }, root)
    const reads = vi.spyOn(fs, 'readdirSync')
    // 扫描依赖使用具名导入，同步后才能观察到它实际读取的目录
    syncBuiltinESMExports()

    expect(getPageFiles('.', options).sort()).toEqual(['keep.vue', 'nested/keep.vue'])
    const visited = reads.mock.calls.map(([directory]) => normalizePath(path.resolve(String(directory))))
    expect(visited).toContain(normalizePath(root))
    expect(visited).toContain(normalizePath(path.join(root, 'nested')))
    for (const directory of excludedDirectories) {
      const excluded = normalizePath(path.join(root, directory))
      expect(visited.some(directory => directory === excluded || directory.startsWith(`${excluded}/`))).toBe(false)
    }
  })

  it('实际项目根中的字符类符号按字面路径处理', async () => {
    const root = path.join(fixture(), 'app[prod]')
    const excluded = page(root, 'src/packages/account/pages/index.vue')
    const included = page(root, 'src/packages/account/pages/detail.vue')
    const ctx = await createPages({
      subPackages: ['src/packages/account/pages'],
      exclude: ['src/packages/account/pages/index.vue'],
    }, { root })

    expect(ctx.subPageMetaData).toHaveLength(1)
    expect(ctx.subPageMetaData[0].pages.map(page => page.path)).toEqual(['detail'])
    expect(getPageFiles(path.dirname(excluded), ctx.options)).toEqual(['detail.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })

  it.each(['替换数组', '原地追加'] as const)('exclude %s后扫描与文件事件立即采用新规则', (change) => {
    const root = fixture()
    const files = ['first.vue', 'second.vue', 'third.vue']
    for (const file of files)
      page(root, `src/pages/${file}`)
    const options = resolveOptions({ exclude: ['src/pages/first.vue'] }, root)
    const directory = path.join(root, 'src/pages')

    expect(getPageFiles(directory, options).sort()).toEqual(['second.vue', 'third.vue'])
    expect(isPageFileInDirectories(path.join(directory, 'first.vue'), options)).toBe(false)
    expect(isPageFileInDirectories(path.join(directory, 'second.vue'), options)).toBe(true)

    if (change === '替换数组')
      options.exclude = ['src/pages/second.vue']
    else
      options.exclude.push('src/pages/second.vue')

    const remaining = change === '替换数组' ? ['first.vue', 'third.vue'] : ['third.vue']
    expect(getPageFiles(directory, options).sort()).toEqual(remaining)
    for (const file of files)
      expect(isPageFileInDirectories(path.join(directory, file), options)).toBe(remaining.includes(file))
  })

  it('忽略完全为空的排除项，并保留合法路径中的空格', async () => {
    const root = fixture()
    const excluded = page(root, 'src/pages/ keep.vue')
    const included = page(root, 'src/pages/keep.vue')
    const ctx = await createPages({ exclude: ['', 'src/pages/ keep.vue'] }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['keep.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.join(root, 'src/pages'), ctx.options)).toBe(true)
  })

  it('排除项首尾不做 trim，以保留带前导空格的目录名', async () => {
    const root = fixture()
    const excluded = page(root, ' src/pages/index.vue')
    const included = page(root, 'src/pages/index.vue')
    const ctx = await createPages({ subPackages: [' src/pages'], exclude: [' src/pages'] }, { root })

    expect(ctx.subPageMetaData).toEqual([])
    expect(ctx.pageMetaData).toHaveLength(1)
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })

  it.each(['!src/pages/index.vue', '!**/index.vue', '!!src/pages/index.vue'])('初始化时明确拒绝否定排除项 %s', (exclude) => {
    expect(() => resolveOptions({ exclude: [exclude] }, fixture())).toThrow(/exclude/i)
  })

  it.each([
    { exclude: 'src/pages/!(keep).vue', files: ['index.vue', 'keep.vue', 'other.vue'], remaining: ['keep.vue'] },
    { exclude: 'src/pages/[!a]ndex.vue', files: ['andex.vue', 'bndex.vue', 'index.vue'], remaining: ['andex.vue'] },
  ])('扫描与文件事件按同一语法解释 $exclude', async ({ exclude, files, remaining }) => {
    const root = fixture()
    for (const file of files)
      page(root, `src/pages/${file}`)
    const ctx = await createPages({ exclude: [exclude] }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options).sort()).toEqual(remaining)
    expect(ctx.pageMetaData).toHaveLength(remaining.length)
    for (const file of files)
      expect(isPageFileInDirectories(path.join(root, 'src/pages', file), ctx.options)).toBe(remaining.includes(file))
  })

  it('字符类目录规则在目录发现和监听阶段保持一致', async () => {
    const root = fixture()
    page(root, 'src/pages/index.vue')
    const excluded = page(root, 'src/qages/index.vue')
    const ctx = await createPages({ dir: 'src/*ages', exclude: ['src/[!p]ages'] }, { root })

    expect(ctx.options.dirs.map(dir => normalizePath(path.resolve(root, dir)))).toEqual([normalizePath(path.join(root, 'src/pages'))])
    expect(isPageDirectoryEvent(path.join(root, 'src/qages'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
  })

  it('按符号链接的配置路径排除，不扩散到同一目标的另一别名', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const target = path.join(workspace, 'shared/pages')
    page(target, 'index.vue')
    fs.mkdirSync(root)
    for (const alias of ['excluded', 'included'])
      fs.symlinkSync(target, path.join(root, alias), process.platform === 'win32' ? 'junction' : 'dir')
    const ctx = await createPages({ subPackages: ['excluded', 'included'], exclude: ['excluded'] }, { root })

    expect(ctx.options.subPackages).toEqual(['included'])
    expect(getPageFiles(path.join(root, 'excluded'), ctx.options)).toEqual([])
    expect(getPageFiles(path.join(root, 'included'), ctx.options)).toEqual(['index.vue'])
    expect(isPageFileInDirectories(path.join(root, 'excluded/index.vue'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(path.join(root, 'included/index.vue'), ctx.options)).toBe(true)
  })

  it('绝对排除模式可以在项目根所在的路径段使用 glob', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const excluded = page(root, 'src/pages/index.vue')
    page(root, 'src/pages/keep.vue')
    const ctx = await createPages({ exclude: [`${normalizePath(workspace)}/*/src/pages/index.vue`] }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['keep.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
  })

  it('绝对目录模式的扫描与事件保持一致', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const included = page(root, 'src/main/pages/index.vue')
    const ctx = await createPages({ dir: `${normalizePath(root)}/src/*/pages`, exclude: [] }, { root })

    expect(ctx.pageMetaData).toHaveLength(1)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
    expect(isPageDirectoryEvent(path.dirname(included), ctx.options)).toBe(true)
  })

  it('保留 glob 对字面方括号的转义', async () => {
    const root = fixture()
    const excluded = page(root, 'src/pages/a[1].vue')
    const included = page(root, 'src/pages/a1.vue')
    const ctx = await createPages({ exclude: ['src/pages/a\\[1\\].vue'] }, { root })

    expect(getPageFiles(path.join(root, 'src/pages'), ctx.options)).toEqual(['a1.vue'])
    expect(isPageFileInDirectories(excluded, ctx.options)).toBe(false)
    expect(isPageFileInDirectories(included, ctx.options)).toBe(true)
  })
})
