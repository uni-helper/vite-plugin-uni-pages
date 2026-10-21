import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const roots: string[] = []
const contexts: PageContext[] = []

function fixture() {
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-targets-')))
  roots.push(workspace)
  const root = path.join(workspace, 'app')
  const target = path.join(workspace, 'external/deep/pages')
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(target, { recursive: true })
  fs.symlinkSync(target, path.join(root, 'src/alias'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  return { workspace, root, target }
}

function page(file: string, title: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage(${JSON.stringify({ style: { navigationBarTitleText: title } })})</script><template><view /></template>`)
}

function output(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
}

async function start(root: string) {
  const ctx = new PageContext({ subPackages: ['src/alias'], outDir: '.', dts: false }, root, 'h5')
  contexts.push(ctx)
  await ctx.updatePagesJSON()
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  return { ctx, updates, watcher }
}

async function dispatch(watcher: EventEmitter, updates: MockInstance<PageContext['updatePagesJSON']>, event: string, file: string): Promise<void> {
  updates.mockClear()
  watcher.emit(event, file)
  await Promise.all(updates.mock.results.map(result => result.value))
}

afterEach(async () => {
  for (const ctx of contexts.splice(0))
    await ctx.disposeWatchers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('符号链接目标恢复', () => {
  it('已存在的目标只监听目标本身，不递归订阅其父目录', async () => {
    const { root, target } = fixture()
    page(path.join(target, 'index.vue'), '初始')
    const { watcher } = await start(root)

    const added = watcher.add.mock.calls.flat(2).map(file => normalizePath(file))
    expect(added).toContain(normalizePath(target))
    expect(added).not.toContain(normalizePath(path.dirname(target)))
  })

  it('关闭页面合并时不注册页面目标监听', async () => {
    const { root, target } = fixture()
    page(path.join(target, 'index.vue'), '初始')
    const ctx = new PageContext({ subPackages: ['src/alias'], outDir: '.', mergePages: false, dts: false }, root, 'h5')
    contexts.push(ctx)
    await ctx.updatePagesJSON()
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])

    const added = watcher.add.mock.calls.flat(2).map(file => normalizePath(file))
    expect(added.filter(file => file.includes('/external'))).toEqual([])
    await ctx.disposeWatchers()
  })

  it('扫描规则收窄时仍刷新既有目录关联，忽略已脱离的旧目标', async () => {
    const { workspace, root, target } = fixture()
    const oldFile = path.join(target, 'nested/index.vue')
    page(oldFile, '旧目标')
    const { ctx, updates, watcher } = await start(root)
    const replacement = path.join(workspace, 'replacement')
    fs.mkdirSync(replacement)
    const alias = path.join(root, 'src/alias')
    fs.unlinkSync(alias)
    fs.symlinkSync(replacement, alias, process.platform === 'win32' ? 'junction' : 'dir')
    ctx.options.subPackagePatterns.splice(0, 1, 'src/alias/nested')
    await ctx.updatePagesJSON()
    expect(output(root).subPackages ?? []).toEqual([])

    await dispatch(watcher, updates, 'change', oldFile)

    expect(updates).not.toHaveBeenCalled()
  })

  it('扫描目录改指空目录后，旧目标事件不再调度更新', async () => {
    const { workspace, root, target } = fixture()
    const oldFile = path.join(target, 'index.vue')
    page(oldFile, '旧目标')
    const { ctx, updates, watcher } = await start(root)
    const replacement = path.join(workspace, 'replacement')
    fs.mkdirSync(replacement)
    const alias = path.join(root, 'src/alias')
    fs.unlinkSync(alias)
    fs.symlinkSync(replacement, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await ctx.updatePagesJSON()
    expect(output(root).subPackages ?? []).toEqual([])

    await dispatch(watcher, updates, 'change', oldFile)

    expect(updates).not.toHaveBeenCalled()
  })

  it('无扩展名文件目标删除后，真实路径 add 恢复页面及后续修改', async () => {
    const { workspace, root, target } = fixture()
    const content = path.join(workspace, 'content')
    page(content, '初始')
    fs.symlinkSync(content, path.join(target, 'index.nvue'), 'file')
    const { updates, watcher } = await start(root)
    expect(output(root).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'index', style: { navigationBarTitleText: '初始' } }] }])

    fs.unlinkSync(content)
    await dispatch(watcher, updates, 'unlink', content)
    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages ?? []).toEqual([])

    page(content, '恢复')
    await dispatch(watcher, updates, 'add', content)
    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'index', style: { navigationBarTitleText: '恢复' } }] }])

    page(content, '恢复后修改')
    await dispatch(watcher, updates, 'change', content)
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('恢复后修改')
  })

  it('已知物理目录内新增的页面以有效别名写入产物', async () => {
    const { root, target } = fixture()
    page(path.join(target, 'index.vue'), '初始')
    const { updates, watcher } = await start(root)
    const added = path.join(target, 'detail.vue')
    page(added, '新页面')

    await dispatch(watcher, updates, 'add', added)

    expect(updates).toHaveBeenCalledOnce()
    const packages = output(root).subPackages
    expect(packages).toHaveLength(1)
    expect(packages[0].root).toBe('src/alias')
    expect(packages[0].pages.map((page: any) => ({ path: page.path, title: page.style.navigationBarTitleText }))).toEqual([
      { path: 'detail', title: '新页面' },
      { path: 'index', title: '初始' },
    ])
  })

  it('目标父目录删除后补订阅尚存祖先，并由目录恢复事件补扫', async () => {
    const { workspace, root, target } = fixture()
    const file = path.join(target, 'profile.vue')
    page(file, '初始')
    const { updates, watcher } = await start(root)
    watcher.add.mockClear()
    const parent = path.dirname(target)
    fs.rmSync(parent, { recursive: true })

    await dispatch(watcher, updates, 'unlinkDir', parent)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages ?? []).toEqual([])
    expect(watcher.add.mock.calls.flat(2).map(file => normalizePath(file))).toContain(normalizePath(path.join(workspace, 'external')))

    page(file, '目录恢复')
    await dispatch(watcher, updates, 'addDir', parent)
    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'profile', style: { navigationBarTitleText: '目录恢复' } }] }])

    page(file, '恢复后修改')
    await dispatch(watcher, updates, 'change', file)
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('恢复后修改')
  })
})
