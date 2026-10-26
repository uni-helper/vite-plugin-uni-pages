import type { UserOptions } from '../packages/core/src'
import type { ControlledPageWatch, TestFixture } from './helpers/fixture'
import fs from 'node:fs'
import { normalizePath } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

async function setup(fixture: TestFixture, exclude: string[] = [], options: UserOptions = {}) {
  fixture.writeConfig()
  fixture.write('src/real/.keep', '')
  fixture.symlink('src/real', 'src/alias', 'dir')
  const ctx = fixture.context({ subPackages: ['src/alias'], exclude, ...options })
  await ctx.updatePagesJSON()
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const watch = await fixture.watch(ctx)
  return { ctx, updates, watch }
}

async function dispatch(updates: { mockClear: () => void }, watch: ControlledPageWatch, event: string, file: string): Promise<void> {
  updates.mockClear()
  watch.emit(event, file)
  await watch.settle()
}

describe('符号链接页面事件', () => {
  it.each(['alias', 'real'])('%s 路径的 change 更新已收录页面', async (directory) => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '更新' } })

    await dispatch(updates, watch, 'change', fixture.path(`src/${directory}/index.vue`))

    expect(updates).toHaveBeenCalledOnce()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('更新')
  })

  it('已删除目标的真实路径 unlink 仍移除页面', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await setup(fixture)
    fs.unlinkSync(fixture.path('src/real/index.vue'))

    await dispatch(updates, watch, 'unlink', fixture.path('src/real/index.vue'))

    expect(updates).toHaveBeenCalledOnce()
    expect(fixture.pagesJson(ctx).subPackages ?? []).toEqual([])
  })

  it('definePage(null) 页面可以通过真实路径变更重新启用', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', null)
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '重新启用' } })

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))

    expect(updates).toHaveBeenCalledOnce()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('重新启用')
  })

  it('真实路径事件按当前词法来源检查排除与目录规则', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const exclude: string[] = []
    const { ctx, updates, watch } = await setup(fixture, exclude)
    exclude.push('src/alias/index.vue')

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))
    expect(updates).not.toHaveBeenCalled()

    exclude.length = 0
    ctx.options.subPackagePatterns.length = 0
    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))
    expect(updates).not.toHaveBeenCalled()
  })

  it('目标自身被词法排除时仍允许有效别名更新', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await setup(fixture, ['src/real'])
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '别名更新' } })

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))

    expect(updates).toHaveBeenCalledOnce()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('别名更新')
  })

  it('未知目标不会通过已知页面身份扩大收录', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('src/unrelated/index.vue', { style: { navigationBarTitleText: '未知' } })

    await dispatch(updates, watch, 'change', fixture.path('src/unrelated/index.vue'))

    expect(updates).not.toHaveBeenCalled()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toHaveLength(1)
  })

  it('文件别名的无扩展名真实目标可以触发更新', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('content', { style: { navigationBarTitleText: '初始' } })
    fixture.symlink('content', 'src/real/index.nvue', 'file')
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('content', { style: { navigationBarTitleText: '无扩展名更新' } })

    await dispatch(updates, watch, 'change', fixture.path('content'))

    expect(updates).toHaveBeenCalledOnce()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('无扩展名更新')
  })
})

describe('符号链接页面的增量读取', () => {
  it.each(['alias', 'real'])('%s 路径内容变化仅重读关联页面', async (directory) => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    fixture.writePage('src/real/other.vue', { style: { navigationBarTitleText: '其他页面' } })
    const { ctx, updates, watch } = await setup(fixture)
    const readFile = vi.spyOn(fs.promises, 'readFile')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '内容更新' } })

    await dispatch(updates, watch, 'change', fixture.path(`src/${directory}/index.vue`))

    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toContainEqual(expect.objectContaining({
      path: 'index',
      style: { navigationBarTitleText: '内容更新' },
    }))
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(fixture.path('src/alias/index.vue'))).length).toBeGreaterThan(0)
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(fixture.path('src/alias/other.vue')))).toHaveLength(0)
  })

  it('映射后的模板变更在加载配置和生成产物前结束', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const onBeforeLoadUserConfig = vi.fn()
    const onBeforeWriteFile = vi.fn()
    const { ctx, updates, watch } = await setup(fixture, [], { onBeforeLoadUserConfig, onBeforeWriteFile })
    onBeforeLoadUserConfig.mockClear()
    onBeforeWriteFile.mockClear()
    fs.appendFileSync(fixture.path('src/real/index.vue'), '\n<!-- template edit -->')

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))

    expect(onBeforeLoadUserConfig).not.toHaveBeenCalled()
    expect(onBeforeWriteFile).not.toHaveBeenCalled()
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('初始')
  })

  it('映射后的元数据变化继续扫描并检查路由冲突', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    fixture.writePage('src/real/other.vue', { style: { navigationBarTitleText: '其他页面' } })
    const onBeforeScanPages = vi.fn()
    const { ctx, updates, watch } = await setup(fixture, [], { onBeforeScanPages })
    const error = vi.fn()
    ctx.setLogger({ error } as any)
    onBeforeScanPages.mockClear()
    fixture.writePage('src/real/index.vue', 'definePage({ path: "alias/other" })')

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))

    expect(onBeforeScanPages).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update pages.json after a file change'),
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('Conflicting generated route') }) }),
    )
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toContainEqual(expect.objectContaining({ path: 'index' }))
  })

  it('同物理文件的主分包 skipped 候选同时恢复并保留分包优先', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    const target = fixture.path('src/real/index.vue')
    fixture.writePage('src/real/index.vue', null)
    fixture.writePage('src/real/other.vue', { style: { navigationBarTitleText: '其他页面' } })
    fs.mkdirSync(fixture.path('src/pages'), { recursive: true })
    fixture.symlink(target, 'src/pages/index.vue', 'file')
    const { ctx, updates, watch } = await setup(fixture)
    expect(ctx.pages.get(normalizePath(fixture.path('src/pages/index.vue')))?.skipped).toBe(true)
    expect(ctx.subPages.get('src/alias')?.get(normalizePath(fixture.path('src/alias/index.vue')))?.skipped).toBe(true)
    const readFile = vi.spyOn(fs.promises, 'readFile')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '恢复' } })

    await dispatch(updates, watch, 'change', target)

    expect(ctx.pageMetaData).toEqual([])
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toContainEqual(expect.objectContaining({
      path: 'index',
      style: { navigationBarTitleText: '恢复' },
    }))
    expect(readFile.mock.calls.filter(call => normalizePath(String(call[0])).endsWith('/other.vue'))).toHaveLength(0)
  })

  it('重叠来源中无关页面的非代表候选不会重复读取', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    fixture.writePage('src/real/other.vue', { style: { navigationBarTitleText: '其他页面' } })
    const { ctx, updates, watch } = await setup(fixture, [], { dir: 'src/real' })
    const readFile = vi.spyOn(fs.promises, 'readFile')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '内容更新' } })

    await dispatch(updates, watch, 'change', fixture.path('src/real/index.vue'))

    expect(ctx.pageMetaData).toEqual([])
    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toContainEqual(expect.objectContaining({
      path: 'index',
      style: { navigationBarTitleText: '内容更新' },
    }))
    expect(readFile.mock.calls.filter(call => normalizePath(String(call[0])).endsWith('/other.vue'))).toHaveLength(0)
  })

  it('新增页面事件刷新结构并重读已有页面', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '结构刷新' } })
    fixture.writePage('src/real/added.vue', { style: { navigationBarTitleText: '新增' } })
    const readFile = vi.spyOn(fs.promises, 'readFile')

    await dispatch(updates, watch, 'add', fixture.path('src/real/added.vue'))

    expect(fixture.pagesJson(ctx).subPackages?.[0].pages).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'index', style: { navigationBarTitleText: '结构刷新' } }),
      expect.objectContaining({ path: 'added', style: { navigationBarTitleText: '新增' } }),
    ]))
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(fixture.path('src/alias/index.vue'))).length).toBeGreaterThan(0)
  })

  it('来源改指后一次 change 刷新目标中的全部页面', async () => {
    const fixture = createFixture('uni-pages-symlink-events-')
    fixture.writePage('src/real/index.vue', { style: { navigationBarTitleText: '旧首页' } })
    fixture.writePage('src/real/other.vue', { style: { navigationBarTitleText: '旧页面' } })
    const { ctx, updates, watch } = await setup(fixture)
    fixture.writePage('src/next/index.vue', { style: { navigationBarTitleText: '新首页' } })
    fixture.writePage('src/next/other.vue', { style: { navigationBarTitleText: '新页面' } })
    fixture.remove('src/alias')
    fixture.symlink('src/next', 'src/alias', 'dir')

    await dispatch(updates, watch, 'change', fixture.path('src/alias/index.vue'))

    expect(fixture.pagesJson(ctx).subPackages?.[0].pages.map(item => item.style?.navigationBarTitleText).sort()).toEqual(['新页面', '新首页'])
  })
})
