import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
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

async function start(root: string, exclude: string[] = []) {
  const ctx = new PageContext({ subPackages: ['src/alias'], exclude, dts: false }, root, 'h5')
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

describe('符号链接页面事件', () => {
  it.each(['alias', 'real'])('%s 路径的 change 更新已收录页面', async (directory) => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { updates, watcher } = await start(root)
    page(target, '更新')

    await dispatch(watcher, updates, 'change', path.join(root, `src/${directory}/index.vue`))

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('更新')
  })

  it('已删除目标的真实路径 unlink 仍移除页面', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { updates, watcher } = await start(root)
    fs.unlinkSync(target)

    await dispatch(watcher, updates, 'unlink', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages ?? []).toEqual([])
  })

  it('definePage(null) 页面可以通过真实路径变更重新启用', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, null)
    const { updates, watcher } = await start(root)
    page(target, '重新启用')

    await dispatch(watcher, updates, 'change', target)

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

    await dispatch(watcher, updates, 'change', target)
    expect(updates).not.toHaveBeenCalled()

    exclude.length = 0
    ctx.options.subPackagePatterns.length = 0
    await dispatch(watcher, updates, 'change', target)
    expect(updates).not.toHaveBeenCalled()
  })

  it('目标自身被词法排除时仍允许有效别名更新', async () => {
    const root = fixture()
    const target = path.join(root, 'src/real/index.vue')
    page(target, '初始')
    const { updates, watcher } = await start(root, ['src/real'])
    page(target, '别名更新')

    await dispatch(watcher, updates, 'change', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('别名更新')
  })

  it('未知目标不会通过已知页面身份扩大收录', async () => {
    const root = fixture()
    page(path.join(root, 'src/real/index.vue'), '初始')
    const { updates, watcher } = await start(root)
    const unknown = path.join(root, 'src/unrelated/index.vue')
    page(unknown, '未知')

    await dispatch(watcher, updates, 'change', unknown)

    expect(updates).not.toHaveBeenCalled()
    expect(output(root).subPackages[0].pages).toHaveLength(1)
  })

  it('文件别名的无扩展名真实目标可以触发更新', async () => {
    const root = fixture()
    const target = path.join(root, 'content')
    page(target, '初始')
    fs.symlinkSync(target, path.join(root, 'src/real/index.nvue'), 'file')
    const { updates, watcher } = await start(root)
    page(target, '无扩展名更新')

    await dispatch(watcher, updates, 'change', target)

    expect(updates).toHaveBeenCalledOnce()
    expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('无扩展名更新')
  })
})
