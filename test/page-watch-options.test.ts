import type { InlineConfig, ServerOptions } from 'vite'
import type { PageContext } from '../packages/core/src'
import type { TestFixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { expect, it, vi } from 'vitest'
import { createFixture } from './helpers/fixture'

async function start(watch: ServerOptions['watch'], external = false, config: Pick<InlineConfig, 'cacheDir' | 'build'> = {}) {
  const fixture = createFixture('uni-pages-watch-options-')
  if (external) {
    fixture.write('shared/.keep', '')
    fixture.symlink('shared', 'pages', 'dir')
  }
  else {
    fs.mkdirSync(fixture.path('pages'))
  }
  fixture.writeConfig()
  fixture.writePage('pages/index.vue', { style: { navigationBarTitleText: '初始' } })
  const context = fixture.context({ dir: 'pages', outDir: '.', dts: false })
  await context.updatePagesJSON()
  const server = await fixture.vite(context, { ...config, server: { watch } })
  return { context, fixture, server }
}

function output(fixture: TestFixture, context: PageContext, title: string): void {
  expect(fixture.pagesJson(context).pages?.[0].style?.navigationBarTitleText).toBe(title)
}

it('转发 Vite 的写稳定性选项', async () => {
  const awaitWriteFinish = { stabilityThreshold: 120, pollInterval: 20 }
  const { context, fixture } = await start({ awaitWriteFinish, atomic: false })
  expect(fixture.watcher(context)?.options).toMatchObject({ awaitWriteFinish, atomic: false })
})

it('vite polling 后端及间隔同时用于页面内容和恢复入口', async () => {
  vi.stubEnv('CHOKIDAR_USEPOLLING', undefined)
  vi.stubEnv('CHOKIDAR_INTERVAL', undefined)
  const watchFile = vi.spyOn(fs, 'watchFile')
  const { context, fixture, server } = await start({ usePolling: true, interval: 73 })
  expect(fixture.watcher(context)?.options).toMatchObject({ usePolling: true, interval: 73 })
  const entrances = new Set(fixture.watchState(context).recoveryPaths)
  expect(entrances.size).toBeGreaterThan(0)
  expect(watchFile.mock.calls.some((call) => {
    const [file, options] = call as unknown as [string, { interval: number }]
    return entrances.has(String(file)) && options.interval === 73
  })).toBe(true)
  await fixture.ready(context, server)
  await fixture.settle(context)

  fixture.writePage('pages/index.vue', { style: { navigationBarTitleText: '更新' } })

  await vi.waitFor(() => output(fixture, context, '更新'), { timeout: 10000 })
})

it('vite 关闭监听时不创建页面内容或恢复入口订阅', async () => {
  const { context, fixture } = await start(null)
  expect(fixture.watcher(context)).toBeUndefined()
  expect(fixture.watchState(context).recoveryPaths).toHaveLength(0)
  const before = fixture.read('pages.json')
  fixture.writePage('pages/index.vue', { style: { navigationBarTitleText: '更新' } })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fixture.read('pages.json')).toBe(before)
})

it.each([
  ['glob', '**/pages/**'],
  ['函数', (file: string, stats?: fs.Stats) => normalizePath(file).endsWith('/pages') && !!stats?.isDirectory()],
] as const)('vite ignored %s 同时约束符号链接目标内容与恢复入口', async (_kind, ignored) => {
  const { context, fixture, server } = await start({ ignored }, true)
  expect(fixture.watcher(context)).toBeUndefined()
  expect(fixture.watchState(context).recoveryPaths).toHaveLength(0)
  await fixture.readyServer(server)
  await fixture.settle(context)
  const updates = vi.spyOn(context, 'updatePagesJSON')

  server.watcher.emit('change', fs.realpathSync.native(fixture.path('pages/index.vue')))
  await fixture.settle(context)

  expect(updates).not.toHaveBeenCalled()
})

it('保留 Vite 默认的输出目录和缓存目录过滤', async () => {
  const { context, fixture, server } = await start(undefined, false, { cacheDir: 'pages/cache', build: { outDir: 'pages/output' } })
  const ignoredDirectories = ['pages/output', 'pages/cache'].map(directory => fixture.path(directory))
  for (const directory of ignoredDirectories)
    fixture.writePage(path.relative(fixture.root, path.join(directory, 'ignored.vue')))
  await fixture.ready(context, server)
  await fixture.settle(context)
  const watched = Object.keys(fixture.watcher(context)!.getWatched()).map(normalizePath)
  for (const directory of ignoredDirectories)
    expect(watched).not.toContain(normalizePath(directory))
  const updates = vi.spyOn(context, 'updatePagesJSON')

  for (const directory of ignoredDirectories)
    server.watcher.emit('change', path.join(directory, 'ignored.vue'))
  await fixture.settle(context)

  expect(updates).not.toHaveBeenCalled()
})
