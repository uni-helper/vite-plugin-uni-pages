import type { UserOptions } from '../packages/core/src'
import type { TestFixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

function fixture() {
  const workspace = createFixture('uni-pages-symlink-targets-')
  workspace.write('external/deep/pages/.keep', '')
  workspace.write('app/src/.keep', '')
  workspace.symlink('external/deep/pages', 'app/src/alias', 'dir')
  workspace.writeConfig({}, 'app/pages.config.json')
  return { workspace, root: workspace.path('app'), target: workspace.path('external/deep/pages') }
}

async function start(workspace: TestFixture, options: UserOptions = {}) {
  const ctx = workspace.context({ subPackages: ['src/alias'], outDir: '.', dts: false, ...options }, 'h5', 'app')
  await ctx.updatePagesJSON()
  const updates = vi.spyOn(ctx, 'updatePagesJSON')
  const watch = await workspace.watch(ctx)
  return { ctx, updates, watch }
}

async function dispatch(updates: { mockClear: () => void }, watch: Awaited<ReturnType<TestFixture['watch']>>, event: string, file: string): Promise<void> {
  updates.mockClear()
  watch.emit(event, file)
  await watch.settle()
}

describe('符号链接目标恢复', () => {
  it('页面目标及其祖先不加入共享 watcher 的订阅', async () => {
    const { workspace, target } = fixture()
    workspace.writePage(path.relative(workspace.root, path.join(target, 'index.vue')), { style: { navigationBarTitleText: '初始' } })
    const { watch } = await start(workspace)

    const added = watch.shared.add.mock.calls.flat(2).map((file: string) => normalizePath(file))
    expect(added).not.toContain(normalizePath(target))
    expect(added).not.toContain(normalizePath(path.dirname(target)))
  })

  it('关闭页面合并时不注册页面目标监听', async () => {
    const { workspace, target } = fixture()
    workspace.writePage(path.relative(workspace.root, path.join(target, 'index.vue')), { style: { navigationBarTitleText: '初始' } })
    const ctx = workspace.context({ subPackages: ['src/alias'], outDir: '.', mergePages: false, dts: false }, 'h5', 'app')
    await ctx.updatePagesJSON()
    const watch = await workspace.watch(ctx)

    const added = watch.shared.add.mock.calls.flat(2).map((file: string) => normalizePath(file))
    expect(added.filter((file: string) => file.includes('/external'))).toEqual([])
    expect(workspace.watcher(ctx)).toBeUndefined()
  })

  it('扫描规则收窄时仍刷新既有目录关联，忽略已脱离的旧目标', async () => {
    const { workspace, target } = fixture()
    const oldFile = path.join(target, 'nested/index.vue')
    workspace.writePage(path.relative(workspace.root, oldFile), { style: { navigationBarTitleText: '旧目标' } })
    const { ctx, updates, watch } = await start(workspace)
    const replacement = workspace.path('replacement')
    workspace.write('replacement/.keep', '')
    workspace.remove('app/src/alias')
    workspace.symlink(replacement, 'app/src/alias', 'dir')
    ctx.options.subPackagePatterns.splice(0, 1, 'src/alias/nested')
    await ctx.updatePagesJSON()
    expect(workspace.pagesJson(ctx).subPackages ?? []).toEqual([])

    await dispatch(updates, watch, 'change', oldFile)

    expect(updates).not.toHaveBeenCalled()
  })

  it('扫描目录改指空目录后，旧目标事件不再调度更新', async () => {
    const { workspace, target } = fixture()
    const oldFile = path.join(target, 'index.vue')
    workspace.writePage(path.relative(workspace.root, oldFile), { style: { navigationBarTitleText: '旧目标' } })
    const { ctx, updates, watch } = await start(workspace)
    const replacement = workspace.path('replacement')
    workspace.write('replacement/.keep', '')
    workspace.remove('app/src/alias')
    workspace.symlink(replacement, 'app/src/alias', 'dir')
    await ctx.updatePagesJSON()
    expect(workspace.pagesJson(ctx).subPackages ?? []).toEqual([])

    await dispatch(updates, watch, 'change', oldFile)

    expect(updates).not.toHaveBeenCalled()
  })

  it('无扩展名文件目标删除后，真实路径 add 恢复页面及后续修改', async () => {
    const { workspace, target } = fixture()
    const content = workspace.path('content')
    workspace.writePage('content', { style: { navigationBarTitleText: '初始' } })
    workspace.symlink(content, path.relative(workspace.root, path.join(target, 'index.nvue')), 'file')
    const { ctx, updates, watch } = await start(workspace)
    expect(workspace.pagesJson(ctx).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'index', style: { navigationBarTitleText: '初始' } }] }])

    fs.unlinkSync(content)
    await dispatch(updates, watch, 'unlink', content)
    expect(updates).toHaveBeenCalledOnce()
    expect(workspace.pagesJson(ctx).subPackages ?? []).toEqual([])

    workspace.writePage('content', { style: { navigationBarTitleText: '恢复' } })
    await dispatch(updates, watch, 'add', content)
    expect(updates).toHaveBeenCalledOnce()
    expect(workspace.pagesJson(ctx).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'index', style: { navigationBarTitleText: '恢复' } }] }])

    workspace.writePage('content', { style: { navigationBarTitleText: '恢复后修改' } })
    await dispatch(updates, watch, 'change', content)
    expect(workspace.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('恢复后修改')
  })

  it('已知物理目录内新增的页面以有效别名写入产物', async () => {
    const { workspace, target } = fixture()
    workspace.writePage(path.relative(workspace.root, path.join(target, 'index.vue')), { style: { navigationBarTitleText: '初始' } })
    const { ctx, updates, watch } = await start(workspace)
    const added = path.join(target, 'detail.vue')
    workspace.writePage(path.relative(workspace.root, added), { style: { navigationBarTitleText: '新页面' } })

    await dispatch(updates, watch, 'add', added)

    expect(updates).toHaveBeenCalledOnce()
    const packages = workspace.pagesJson(ctx).subPackages ?? []
    expect(packages).toHaveLength(1)
    expect(packages[0].root).toBe('src/alias')
    expect(packages[0].pages.map(page => ({ path: page.path, title: page.style?.navigationBarTitleText }))).toEqual([
      { path: 'detail', title: '新页面' },
      { path: 'index', title: '初始' },
    ])
  })

  it('目标父目录重建时，同一受控批次的入口、ready 与目录通知最多补扫两轮', async () => {
    const { workspace, root, target } = fixture()
    const file = path.join(target, 'profile.vue')
    const home = path.join(root, 'src/pages/index.vue')
    workspace.writePage(path.relative(workspace.root, file), { style: { navigationBarTitleText: '初始' } })
    workspace.writePage('app/src/pages/index.vue', { style: { navigationBarTitleText: '首页' } })
    const { ctx, updates, watch } = await start(workspace)
    const initialWatcher = watch.page!
    watch.shared.add.mockClear()
    const parent = path.dirname(target)
    fs.rmSync(parent, { recursive: true })

    updates.mockClear()
    watch.emitEntrance(parent, 'change', 'rename', path.basename(parent))
    await watch.settle()

    expect(updates).toHaveBeenCalledOnce()
    expect(workspace.pagesJson(ctx).subPackages ?? []).toEqual([])
    expect(initialWatcher.close).toHaveBeenCalledOnce()
    const remainingWatcher = watch.page!
    expect(remainingWatcher.add.mock.calls.flat(2)).toEqual([normalizePath(path.dirname(home))])
    remainingWatcher.emit('ready')
    await watch.settle()
    const ancestorPath = normalizePath(path.dirname(parent))
    expect(watch.state().recoveryPaths).toContain(ancestorPath)
    expect(watch.shared.add.mock.calls.flat(2).map((entry: string) => normalizePath(entry))).not.toContain(normalizePath(workspace.path('external')))

    watch.shared.add.mockClear()
    updates.mockClear()
    const scans = vi.fn()
    ctx.options.onBeforeScanPages = scans
    workspace.writePage(path.relative(workspace.root, file), { style: { navigationBarTitleText: '目录恢复' } })
    watch.emitEntrance(ancestorPath, 'change', 'rename', path.basename(parent))
    const restoredWatcher = watch.page!
    restoredWatcher.emit('ready')
    watch.shared.emit('addDir', path.join(root, 'src/alias'))
    await watch.settle()

    expect(updates.mock.calls.every(([file]) => file === undefined)).toBe(true)
    expect(updates.mock.calls.length).toBeLessThanOrEqual(2)
    expect(scans.mock.calls.length).toBeGreaterThan(0)
    expect(scans.mock.calls.length).toBeLessThanOrEqual(2)
    expect(watch.page).toBe(restoredWatcher)
    expect(restoredWatcher).not.toBe(remainingWatcher)
    expect(remainingWatcher.close).toHaveBeenCalledOnce()
    expect(restoredWatcher.add.mock.calls.flat(2).sort()).toEqual([normalizePath(path.dirname(home)), normalizePath(target)].sort())
    expect(watch.state().recoveryPaths).not.toContain(ancestorPath)
    expect(watch.entrance(ancestorPath)?.listenerCount('change')).toBe(0)
    expect(watch.shared.add.mock.calls.flat(2).map((entry: string) => normalizePath(entry))).not.toContain(normalizePath(target))
    expect(workspace.pagesJson(ctx).subPackages).toMatchObject([{ root: 'src/alias', pages: [{ path: 'profile', style: { navigationBarTitleText: '目录恢复' } }] }])

    const readFile = vi.spyOn(fs.promises, 'readFile')
    workspace.writePage(path.relative(workspace.root, file), { style: { navigationBarTitleText: '恢复后修改' } })
    await dispatch(updates, watch, 'change', file)

    const lexicalFile = normalizePath(path.join(root, 'src/alias/profile.vue'))
    expect(updates).toHaveBeenCalledOnce()
    expect(updates).toHaveBeenCalledWith(lexicalFile)
    expect(readFile.mock.calls.filter(call => call[0] === lexicalFile)).toHaveLength(1)
    expect(readFile.mock.calls.filter(call => call[0] === normalizePath(home))).toHaveLength(0)
    expect(workspace.pagesJson(ctx).subPackages?.[0].pages[0].style?.navigationBarTitleText).toBe('恢复后修改')
  })
})
