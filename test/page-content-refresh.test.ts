import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { UserOptions } from '../packages/core/src'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const roots: string[] = []
const contexts: PageContext[] = []

const scopes = [
  { name: '主包', options: { dir: 'src/pages' }, file: 'src/pages/index.vue', route: 'pages/index', sub: false },
  { name: '分包', options: { subPackages: [{ dir: 'src/pkg/pages', root: 'pkg' }] }, file: 'src/pkg/pages/index.vue', route: 'pages/index', sub: true },
] satisfies { name: string, options: UserOptions, file: string, route: string, sub: boolean }[]

function macro(title: string): string {
  return `definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} }, tabBar: { text: ${JSON.stringify(title)} } })`
}

function write(file: string, definition: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>${definition}</script><template><view /></template>`)
}

async function fixture(scope: { options: UserOptions, file: string }, definition = macro('初始'), dts = false): Promise<{ ctx: PageContext, file: string }> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-content-refresh-')))
  roots.push(root)
  const file = normalizePath(path.join(root, scope.file))
  write(file, definition)
  const ctx = new PageContext({ ...scope.options, dts }, root, 'h5')
  contexts.push(ctx)
  await ctx.updatePagesJSON()
  return { ctx, file }
}

function pages(ctx: PageContext, sub: boolean) {
  return sub ? ctx.subPageMetaData[0]?.pages ?? [] : ctx.pageMetaData
}

function tabBar(ctx: PageContext, file: string) {
  const page = ctx.pages.get(file) ?? [...ctx.subPages.values()].map(pages => pages.get(file)).find(Boolean)
  return page?.getTabBar()
}

afterEach(async () => {
  for (const ctx of contexts.splice(0))
    await ctx.disposeWatchers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

it('重叠主分包的 skipped 候选在增量更新时共同刷新，保持分包优先', async () => {
  const { ctx, file } = await fixture({
    ...scopes[0],
    options: { dir: 'src/pages', subPackages: [{ dir: 'src/pages', root: 'pages' }] },
  }, 'definePage(null)')
  expect(ctx.pageMetaData).toEqual([])
  expect(ctx.subPageMetaData).toEqual([])

  write(file, macro('重新启用'))
  await ctx.updatePagesJSON(file)

  expect(ctx.pageMetaData).toEqual([])
  expect(ctx.subPageMetaData).toMatchObject([{
    root: 'pages',
    pages: [{ path: 'index', style: { navigationBarTitleText: '重新启用' } }],
  }])
})

describe.each(scopes)('$name 页面内容刷新', (scope) => {
  it('同路径文件快速删建后全量扫描读取新内容', async () => {
    const { ctx, file } = await fixture(scope)
    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('初始')

    fs.unlinkSync(file)
    write(file, macro('文件重建'))
    await ctx.updatePagesJSON()

    expect(pages(ctx, scope.sub)).toMatchObject([{ path: scope.route, style: { navigationBarTitleText: '文件重建' } }])
    expect((await tabBar(ctx, file))?.text).toBe('文件重建')
  })

  it('同路径目录快速删建后全量扫描读取新内容', async () => {
    const { ctx, file } = await fixture(scope)

    fs.rmSync(path.dirname(file), { recursive: true })
    write(file, macro('目录重建'))
    await ctx.updatePagesJSON()

    expect(pages(ctx, scope.sub)).toMatchObject([{ path: scope.route, style: { navigationBarTitleText: '目录重建' } }])
  })

  it('缺失期间已经扫描的页面重建后恢复', async () => {
    const { ctx, file } = await fixture(scope)

    fs.rmSync(path.dirname(file), { recursive: true })
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)).toEqual([])

    write(file, macro('缺失后恢复'))
    await ctx.updatePagesJSON()

    expect(pages(ctx, scope.sub)).toMatchObject([{ path: scope.route, style: { navigationBarTitleText: '缺失后恢复' } }])
  })

  it('ready 补扫读取已有页面的新内容', async () => {
    const { ctx, file } = await fixture(scope)
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    await ctx.setupWatcher(watcher as any)
    const update = vi.spyOn(ctx, 'updatePagesJSON')

    write(file, macro('就绪前修改'))
    watcher.emit('ready')
    expect(update).toHaveBeenCalledOnce()
    await update.mock.results[0].value

    expect(pages(ctx, scope.sub)).toMatchObject([{ path: scope.route, style: { navigationBarTitleText: '就绪前修改' } }])
  })

  it('ready 补扫同步更新 pages.json、虚拟模块与导航声明的页面路径', async () => {
    const prefix = scope.sub ? 'pkg' : 'pages'
    const previous = `${prefix}/previous`
    const current = `${prefix}/current`
    const { ctx, file } = await fixture(scope, `definePage({ path: ${JSON.stringify(previous)} })`, true)
    const declarationPath = path.join(ctx.root, 'uni-pages.d.ts')
    expect(fs.readFileSync(declarationPath, 'utf8')).toContain(`"/${previous}"`)
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    await ctx.setupWatcher(watcher as any)
    const update = vi.spyOn(ctx, 'updatePagesJSON')

    write(file, `definePage({ path: ${JSON.stringify(current)} })`)
    watcher.emit('ready')
    expect(update).toHaveBeenCalledOnce()
    await update.mock.results[0].value

    const output = parse(fs.readFileSync(ctx.resolvedPagesJSONPath, 'utf8')) as unknown as PagesConfig
    const virtual = await import(`data:text/javascript,${encodeURIComponent(ctx.virtualModule())}`) as PagesConfig
    for (const source of [output, virtual]) {
      const routes = [
        ...source.pages?.map(page => page.path) ?? [],
        ...source.subPackages?.flatMap(pkg => pkg.pages.map(page => path.posix.join(pkg.root, page.path))) ?? [],
      ]
      expect(routes).toEqual([current])
    }
    const declared = [...fs.readFileSync(declarationPath, 'utf8').matchAll(/"\/([^"\n]+)"/g)].map(match => match[1])
    expect(declared).toEqual([current])
  })

  it('scanAndMerge 重读已有页面内容', async () => {
    const { ctx, file } = await fixture(scope)

    write(file, macro('补扫修改'))
    await ctx.scanAndMerge()

    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('补扫修改')
  })

  it('普通 change 更新配置，无配置变化时跳过完整生成', async () => {
    const { ctx, file } = await fixture(scope)
    const otherFile = normalizePath(path.join(path.dirname(file), 'other.vue'))
    write(otherFile, macro('其他页面'))
    await ctx.updatePagesJSON()
    const readFile = vi.spyOn(fs.promises, 'readFile')

    write(file, macro('普通修改'))
    expect(await ctx.updatePagesJSON(file)).toBe(true)
    expect(pages(ctx, scope.sub).find(page => page.path === scope.route)?.style?.navigationBarTitleText).toBe('普通修改')
    expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)
    expect(readFile.mock.calls.filter(call => call[0] === otherFile)).toHaveLength(0)

    fs.appendFileSync(file, '\n')
    expect(await ctx.updatePagesJSON(file)).toBe(false)
  })

  it('全量更新中配置和 tabBar 共用一次页面读取', async () => {
    const { ctx, file } = await fixture(scope)
    const readFile = vi.spyOn(fs.promises, 'readFile')

    write(file, macro('共享读取'))
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('共享读取')
    expect((await tabBar(ctx, file))?.text).toBe('共享读取')
    expect(readFile.mock.calls.filter(call => call[0] === file)).toHaveLength(1)
  })

  it('全量扫描支持 definePage 配置与 null 互转', async () => {
    const { ctx, file } = await fixture(scope)

    write(file, 'definePage(null)')
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)).toEqual([])
    expect(await tabBar(ctx, file)).toBeUndefined()

    write(file, macro('重新收录'))
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)).toMatchObject([{ path: scope.route, style: { navigationBarTitleText: '重新收录' } }])
    expect((await tabBar(ctx, file))?.text).toBe('重新收录')
  })

  it.each([false, true])('读取失败每轮只告警一次，修复后下一轮扫描恢复，增量：%s', async (incremental) => {
    const { ctx, file } = await fixture(scope, 'definePage(() => { throw new Error("refresh failure") })')
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)

    await ctx.updatePagesJSON(incremental ? file : undefined)
    expect(warn.mock.calls.filter(call => String(call[0]).includes('refresh failure'))).toHaveLength(1)

    write(file, macro('失败后恢复'))
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('失败后恢复')
    expect(warn.mock.calls.filter(call => String(call[0]).includes('refresh failure'))).toHaveLength(1)
  })

  it.each([false, true])('已有配置读取失败时保留上次结果，下一轮全量扫描恢复，增量：%s', async (incremental) => {
    const { ctx, file } = await fixture(scope)
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)

    write(file, 'definePage(() => { throw new Error("refresh failure") })')
    await ctx.updatePagesJSON(incremental ? file : undefined)
    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('初始')
    expect((await tabBar(ctx, file))?.text).toBe('初始')
    expect(warn.mock.calls.filter(call => String(call[0]).includes('refresh failure'))).toHaveLength(1)

    write(file, macro('再次恢复'))
    await ctx.updatePagesJSON()
    expect(pages(ctx, scope.sub)[0].style?.navigationBarTitleText).toBe('再次恢复')
  })
})
