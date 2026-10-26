import type { ServerOptions } from 'vite'
import type { UserOptions } from '../packages/core/src'
import type { TestFixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { expect, it, vi } from 'vitest'
import * as macro from '../packages/core/src/macro'
import { createFixture } from './helpers/fixture'

async function setup(fixture: TestFixture, options: UserOptions = {}, watch?: ServerOptions['watch']) {
  if (process.platform === 'win32')
    vi.stubEnv('CHOKIDAR_USEPOLLING', 'true')
  vi.stubEnv('CHOKIDAR_INTERVAL', undefined)
  fixture.writeConfig({}, 'app/pages.config.json')
  const context = fixture.context({ dir: 'pages', outDir: '.', dts: false, ...options }, 'h5', 'app')
  await context.updatePagesJSON()
  const server = await fixture.vite(context, { server: { watch } })
  const probe = fixture.probeVite(context, server)
  await probe.settle()
  probe.reset()
  return { context, probe, server }
}

function output(fixture: TestFixture, context: Parameters<TestFixture['pagesJson']>[0]): any {
  return fixture.pagesJson(context)
}

it('shared 与 owned 均收到保存事件时，目标页只读取解析一次，无关页不重读', async () => {
  const fixture = createFixture('uni-pages-watch-ownership-')
  const file = normalizePath(fixture.path('app/pages/index.vue'))
  const unrelated = normalizePath(fixture.path('app/pages/unrelated.vue'))
  fixture.writePage('app/pages/index.vue', { style: { navigationBarTitleText: '初始' } })
  fixture.writePage('app/pages/unrelated.vue', { style: { navigationBarTitleText: '无关页' } })
  const { context, probe } = await setup(fixture)
  const reads = vi.spyOn(fs.promises, 'readFile')
  const parses = vi.spyOn(macro, 'evaluateDefinePage')

  fixture.writePage('app/pages/index.vue', { style: { navigationBarTitleText: '保存后' } })

  await vi.waitFor(() => {
    for (const owner of ['shared', 'owned'] as const)
      expect(probe.events).toContainEqual({ owner, event: 'change', file })
    expect(output(fixture, context).pages.find((entry: any) => entry.path === 'pages/index').style.navigationBarTitleText).toBe('保存后')
  }, { timeout: 10000 })
  await probe.settle()
  expect(reads.mock.calls.filter(([read]) => normalizePath(String(read)) === file)).toHaveLength(1)
  expect(parses.mock.calls.filter(([, parsed]) => normalizePath(parsed) === file)).toHaveLength(1)
  expect(reads.mock.calls.filter(([read]) => normalizePath(String(read)) === unrelated)).toHaveLength(0)
  expect(parses.mock.calls.filter(([, parsed]) => normalizePath(parsed) === unrelated)).toHaveLength(0)
  expect(probe.updates).toHaveBeenCalledExactlyOnceWith(file)
}, 20000)

it('root 外词法来源可更新被 Vite ignored 排除的 root 内物理目标', async () => {
  const fixture = createFixture('uni-pages-watch-ownership-')
  const target = fixture.path('app/hidden-target')
  const source = fixture.path('alias')
  const file = normalizePath(path.join(target, 'index.vue'))
  fixture.writePage('app/hidden-target/index.vue', { style: { navigationBarTitleText: '初始' } })
  fixture.symlink(target, source, 'dir')
  const { context, probe, server } = await setup(fixture, { subPackages: [{ dir: '../alias', root: 'feature' }] }, { ignored: '**/hidden-target/**' })
  expect(Object.keys(server.watcher.getWatched()).map(normalizePath)).not.toContain(normalizePath(target))

  fixture.writePage('app/hidden-target/index.vue', { style: { navigationBarTitleText: '保存后' } })

  await vi.waitFor(() => expect(output(fixture, context).subPackages[0].pages[0].style.navigationBarTitleText).toBe('保存后'), { timeout: 10000 })
  await probe.settle()
  expect(probe.events).toContainEqual({ owner: 'owned', event: 'change', file })
  expect(probe.events.filter(event => event.owner === 'shared' && event.file === file)).toEqual([])
}, 20000)

it('root 外词法入口改指 root 内目标后恢复页面及后续内容更新', async () => {
  const fixture = createFixture('uni-pages-watch-ownership-')
  const previous = fixture.path('app/content-a')
  const target = fixture.path('app/content-b')
  const source = fixture.path('alias')
  fixture.writePage('app/content-a/index.vue', { style: { navigationBarTitleText: '旧目标' } })
  fixture.writePage('app/content-b/index.vue', { style: { navigationBarTitleText: '新目标' } })
  fixture.symlink(previous, source, 'dir')
  const { context, probe } = await setup(fixture, { subPackages: [{ dir: '../alias', root: 'feature' }] })

  fixture.remove(source)
  fixture.symlink(target, source, 'dir')

  await vi.waitFor(() => expect(output(fixture, context).subPackages[0].pages[0].style.navigationBarTitleText).toBe('新目标'), { timeout: 10000 })
  await probe.settle()
  fixture.writePage('app/content-b/index.vue', { style: { navigationBarTitleText: '再次保存' } })
  await vi.waitFor(() => expect(output(fixture, context).subPackages[0].pages[0].style.navigationBarTitleText).toBe('再次保存'), { timeout: 10000 })
}, 20000)

it('exclude: [] 的页面来源链接进 node_modules 时仍监听内容', async () => {
  const fixture = createFixture('uni-pages-watch-ownership-')
  const target = fixture.path('app/node_modules/@scope/ui/pages')
  const alias = fixture.path('app/src/alias')
  fixture.writePage('app/node_modules/@scope/ui/pages/index.vue', { style: { navigationBarTitleText: '初始' } })
  fixture.symlink(target, alias, 'dir')
  const { context, probe } = await setup(fixture, { subPackages: ['src/alias'], exclude: [] })
  expect(output(fixture, context).subPackages[0].pages[0].style.navigationBarTitleText).toBe('初始')

  fixture.writePage('app/node_modules/@scope/ui/pages/index.vue', { style: { navigationBarTitleText: '更新' } })
  await vi.waitFor(() => expect(output(fixture, context).subPackages[0].pages[0].style.navigationBarTitleText).toBe('更新'), { timeout: 10000 })
  await probe.settle()
  expect(probe.updates).toHaveBeenCalledWith(normalizePath(path.join(alias, 'index.vue')))
}, 20000)

it('符号链接页面文件原子替换只触发一次增量读取', async () => {
  const fixture = createFixture('uni-pages-watch-ownership-')
  const target = fixture.path('external/real.vue')
  const temporary = fixture.path('external/.real.tmp')
  const alias = fixture.path('app/pages/index.vue')
  fixture.writePage('external/real.vue', { style: { navigationBarTitleText: '初始' } })
  fixture.writePage('app/pages/index.vue', { style: { navigationBarTitleText: '占位' } })
  fixture.remove(alias)
  fixture.symlink(target, alias, 'file')
  const { context, probe } = await setup(fixture)
  const loads = vi.fn()
  context.options.onBeforeLoadUserConfig = loads
  fixture.writePage('external/.real.tmp', { style: { navigationBarTitleText: '更新' } })
  fs.renameSync(temporary, target)

  await vi.waitFor(() => expect(output(fixture, context).pages.find((entry: any) => entry.path === 'pages/index').style.navigationBarTitleText).toBe('更新'), { timeout: 10000 })
  await probe.settle()
  expect(probe.updates).toHaveBeenCalledOnce()
  expect(probe.updates).toHaveBeenCalledWith(normalizePath(alias))
  expect(loads).toHaveBeenCalledOnce()
}, 20000)
