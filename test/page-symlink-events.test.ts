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

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-events-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/real'), { recursive: true })
  fs.symlinkSync(path.join(root, 'src/real'), path.join(root, 'src/alias'), 'junction')
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  return root
}

function page(file: string, title: string | null): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage(${title === null ? 'null' : JSON.stringify({ style: { navigationBarTitleText: title } })})</script><template><view /></template>`)
}

function output(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8'))
}

async function start(root: string, exclude: string[] = [], options: UserOptions = {}) {
  const ctx = new PageContext({ subPackages: ['src/alias'], exclude, dts: false, ...options }, root, 'h5')
  contexts.push(ctx)
  await ctx.updatePagesJSON()
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  return { ctx, updates, watcher }
}

async function dispatch(ctx: PageContext, watcher: EventEmitter, event: string, file: string): Promise<void> {
  vi.mocked(ctx.updatePagesJSON).mockClear()
  watcher.emit(event, file)
  await (ctx as unknown as { pendingPageFlush?: Promise<void> }).pendingPageFlush
}

afterEach(async () => {
  for (const ctx of contexts.splice(0))
    await ctx.disposeWatchers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('符号链接页面事件', () => {
  it.each(['alias', 'real'])('%s 路径的 change 更新已收录页面', async (directory) => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { ctx, updates, watcher } = await start(root)
    page(target, '更新')

    await dispatch(ctx, watcher, 'change', path.join(root, `src/${directory}/index.vue`))

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('更新')
  })

  it('已删除目标的真实路径 unlink 仍移除页面', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { ctx, updates, watcher } = await start(root)
    fs.unlinkSync(target)

    await dispatch(ctx, watcher, 'unlink', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages ?? []).toEqual([])
  })

  it('definePage(null) 页面可以通过真实路径变更重新启用', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, null)
    const { ctx, updates, watcher } = await start(root)
    page(target, '重新启用')

    await dispatch(ctx, watcher, 'change', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('重新启用')
  })

  it('真实路径事件按当前词法来源检查排除与目录规则', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const exclude: string[] = []
    const { ctx, updates, watcher } = await start(root, exclude)
    exclude.push('src/alias/index.vue')

    await dispatch(ctx, watcher, 'change', target)
    expect(updates).not.toHaveBeenCalled()

    exclude.length = 0
    ctx.options.subPackagePatterns.length = 0
    await dispatch(ctx, watcher, 'change', target)
    expect(updates).not.toHaveBeenCalled()
  })

  it('目标自身被词法排除时仍允许有效别名更新', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { ctx, updates, watcher } = await start(root, ['src/real'])
    page(target, '别名更新')

    await dispatch(ctx, watcher, 'change', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('别名更新')
  })

  it('未知目标不会通过已知页面身份扩大收录', async () => {
    const root = fixture()
    page(path.join(root, 'src/real/index.vue'), '初始')
    const { ctx, updates, watcher } = await start(root)
    const unknown = path.join(root, 'src/unrelated/index.vue')
    page(unknown, '未知')

    await dispatch(ctx, watcher, 'change', unknown)

    expect(updates).not.toHaveBeenCalled()
    expect(output(root).subPackages[0].pages).toHaveLength(1)
  })

  it('文件别名的无扩展名真实目标可以触发更新', async () => {
    const root = fixture()
    const target = path.join(root, 'content')
    page(target, '初始')
    fs.symlinkSync(target, path.join(root, 'src/real/index.nvue'), 'file')
    const { ctx, updates, watcher } = await start(root)
    page(target, '无扩展名更新')

    await dispatch(ctx, watcher, 'change', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('无扩展名更新')
  })
})

describe('符号链接页面的增量读取', () => {
  it.each(['alias', 'real'])('%s 路径内容变化仅重读关联页面', async (directory) => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    const unrelated = path.join(root, 'src/real/other.vue')
    page(target, '初始')
    page(unrelated, '其他页面')
    const { ctx, watcher } = await start(root)
    const readFile = vi.spyOn(fs.promises, 'readFile')
    page(target, '内容更新')

    await dispatch(ctx, watcher, 'change', path.join(root, `src/${directory}/index.vue`))

    expect(output(root).subPackages[0].pages).toContainEqual(expect.objectContaining({
      path: 'index',
      style: { navigationBarTitleText: '内容更新' },
    }))
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(path.join(root, 'src/alias/index.vue'))).length).toBeGreaterThan(0)
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(path.join(root, 'src/alias/other.vue')))).toHaveLength(0)
  })

  it('映射后的模板变更在加载配置和生成产物前结束', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const onBeforeLoadUserConfig = vi.fn()
    const onBeforeWriteFile = vi.fn()
    const { ctx, watcher } = await start(root, [], { onBeforeLoadUserConfig, onBeforeWriteFile })
    onBeforeLoadUserConfig.mockClear()
    onBeforeWriteFile.mockClear()
    fs.appendFileSync(target, '\n<!-- template edit -->')

    await dispatch(ctx, watcher, 'change', target)

    expect(onBeforeLoadUserConfig).not.toHaveBeenCalled()
    expect(onBeforeWriteFile).not.toHaveBeenCalled()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('初始')
  })

  it('映射后的元数据变化继续扫描并检查路由冲突', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    page(path.join(root, 'src/real/other.vue'), '其他页面')
    const onBeforeScanPages = vi.fn()
    const { ctx, watcher } = await start(root, [], { onBeforeScanPages })
    const error = vi.fn()
    ctx.setLogger({ error } as any)
    onBeforeScanPages.mockClear()
    fs.writeFileSync(target, '<script setup>definePage({ path: "alias/other" })</script>')

    await dispatch(ctx, watcher, 'change', target)

    expect(onBeforeScanPages).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update pages.json after a file change'),
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('Conflicting generated route') }) }),
    )
    expect(output(root).subPackages[0].pages).toContainEqual(expect.objectContaining({ path: 'index' }))
  })

  it('同物理文件的主分包 skipped 候选同时恢复并保留分包优先', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, null)
    page(path.join(root, 'src/real/other.vue'), '其他页面')
    fs.mkdirSync(path.join(root, 'src/pages'))
    fs.symlinkSync(target, path.join(root, 'src/pages/index.vue'), 'file')
    const { ctx, watcher } = await start(root)
    expect(ctx.pages.get(normalizePath(path.join(root, 'src/pages/index.vue')))?.skipped).toBe(true)
    expect(ctx.subPages.get('src/alias')?.get(normalizePath(path.join(root, 'src/alias/index.vue')))?.skipped).toBe(true)
    const readFile = vi.spyOn(fs.promises, 'readFile')
    page(target, '恢复')

    await dispatch(ctx, watcher, 'change', target)

    expect(ctx.pageMetaData).toEqual([])
    expect(output(root).subPackages[0].pages).toContainEqual(expect.objectContaining({
      path: 'index',
      style: { navigationBarTitleText: '恢复' },
    }))
    expect(readFile.mock.calls.filter(call => normalizePath(String(call[0])).endsWith('/other.vue'))).toHaveLength(0)
  })

  it('新增页面事件刷新结构并重读已有页面', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    const added = path.join(root, 'src/real/added.vue')
    page(target, '初始')
    const { ctx, watcher } = await start(root)
    page(target, '结构刷新')
    page(added, '新增')
    const readFile = vi.spyOn(fs.promises, 'readFile')

    await dispatch(ctx, watcher, 'add', added)

    expect(output(root).subPackages[0].pages).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'index', style: { navigationBarTitleText: '结构刷新' } }),
      expect.objectContaining({ path: 'added', style: { navigationBarTitleText: '新增' } }),
    ]))
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(path.join(root, 'src/alias/index.vue'))).length).toBeGreaterThan(0)
  })

  it('来源改指后一次 change 刷新目标中的全部页面', async () => {
    const root = fixture()
    page(path.join(root, 'src/real/index.vue'), '旧首页')
    page(path.join(root, 'src/real/other.vue'), '旧页面')
    const { ctx, watcher } = await start(root)
    page(path.join(root, 'src/next/index.vue'), '新首页')
    page(path.join(root, 'src/next/other.vue'), '新页面')
    fs.unlinkSync(path.join(root, 'src/alias'))
    fs.symlinkSync(path.join(root, 'src/next'), path.join(root, 'src/alias'), 'junction')

    await dispatch(ctx, watcher, 'change', path.join(root, 'src/alias/index.vue'))

    expect(output(root).subPackages[0].pages.map((item: any) => item.style.navigationBarTitleText).sort()).toEqual(['新页面', '新首页'])
  })
})
