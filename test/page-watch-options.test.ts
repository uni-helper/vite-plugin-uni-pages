import type { InlineConfig, ServerOptions, ViteDevServer } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { createServer, normalizePath } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const roots: string[] = []
const contexts: PageContext[] = []
const servers: ViteDevServer[] = []

interface ReadyWatcher {
  _readyEmitted?: boolean
  once: (event: 'ready', listener: () => void) => unknown
}

interface WatchState {
  pendingPageFlush?: Promise<void>
  pendingPageUpdate?: unknown
  pendingUpdate: Promise<void>
  pageWatcher: {
    watcher?: ReadyWatcher & { options: { usePolling: boolean, interval: number }, getWatched: () => Record<string, string[]> }
    recoveryWatchers: Map<string, { watcher: fs.StatWatcher }>
  }
}

async function waitForReady(watcher: ReadyWatcher): Promise<void> {
  if (!watcher._readyEmitted)
    await new Promise<void>(resolve => watcher.once('ready', resolve))
}

async function settleUpdates(state: WatchState): Promise<void> {
  while (true) {
    const update = state.pendingUpdate
    await state.pendingPageFlush
    await update
    if (!state.pendingPageFlush && !state.pendingPageUpdate && update === state.pendingUpdate)
      return
  }
}

async function start(watch: ServerOptions['watch'], external = false, config: Pick<InlineConfig, 'cacheDir' | 'build'> = {}) {
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-options-')))
  roots.push(workspace)
  const root = path.join(workspace, 'app')
  fs.mkdirSync(root)
  if (external) {
    const target = path.join(workspace, 'shared')
    fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(root, 'pages'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  else {
    fs.mkdirSync(path.join(root, 'pages'))
  }
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  const file = path.join(root, 'pages/index.vue')
  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '初始' } })</script>`)
  const context = new PageContext({ dir: 'pages', outDir: '.', dts: false }, root, 'h5')
  contexts.push(context)
  await context.updatePagesJSON()
  const server = await createServer({ ...config, root, configFile: false, appType: 'custom', logLevel: 'silent', server: { watch, middlewareMode: true } })
  servers.push(server)
  context.setupViteServer(server)
  const state = context as unknown as WatchState
  return { root, file, context, state, server }
}

afterEach(async () => {
  for (const context of contexts.splice(0))
    await context.disposeWatchers()
  for (const server of servers.splice(0))
    await server.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

it('vite polling 后端及间隔同时用于页面内容和恢复入口', async () => {
  vi.stubEnv('CHOKIDAR_USEPOLLING', undefined)
  vi.stubEnv('CHOKIDAR_INTERVAL', undefined)
  const watchFile = vi.spyOn(fs, 'watchFile')
  const { root, file, state, server } = await start({ usePolling: true, interval: 73 })
  expect(state.pageWatcher.watcher?.options).toMatchObject({ usePolling: true, interval: 73 })
  const entrances = new Set(state.pageWatcher.recoveryWatchers.keys())
  expect(entrances.size).toBeGreaterThan(0)
  expect(watchFile.mock.calls.some((call) => {
    const [file, options] = call as unknown as [string, { interval: number }]
    return entrances.has(String(file)) && options.interval === 73
  })).toBe(true)
  await Promise.all([waitForReady(state.pageWatcher.watcher!), waitForReady(server.watcher)])
  await settleUpdates(state)

  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '更新' } })</script>`)

  await vi.waitFor(() => {
    const result = parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8')) as any
    expect(result.pages[0].style.navigationBarTitleText).toBe('更新')
  }, { timeout: 10000 })
})

it('vite 关闭监听时不创建页面内容或恢复入口订阅', async () => {
  const { root, file, state } = await start(null)
  expect(state.pageWatcher.watcher).toBeUndefined()
  expect(state.pageWatcher.recoveryWatchers.size).toBe(0)
  const before = fs.readFileSync(path.join(root, 'pages.json'), 'utf8')
  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: '更新' } })</script>`)
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fs.readFileSync(path.join(root, 'pages.json'), 'utf8')).toBe(before)
})

it.each([
  ['glob', '**/pages/**'],
  ['函数', (file: string, stats?: fs.Stats) => normalizePath(file).endsWith('/pages') && !!stats?.isDirectory()],
] as const)('vite ignored %s 同时约束符号链接目标内容与恢复入口', async (_kind, ignored) => {
  const { file, context, state, server } = await start({ ignored }, true)
  expect(state.pageWatcher.watcher).toBeUndefined()
  expect(state.pageWatcher.recoveryWatchers.size).toBe(0)
  await waitForReady(server.watcher)
  await settleUpdates(state)
  const updates = vi.spyOn(context, 'updatePagesJSON')

  server.watcher.emit('change', fs.realpathSync.native(file))
  await settleUpdates(state)

  expect(updates).not.toHaveBeenCalled()
})

it('保留 Vite 默认的输出目录和缓存目录过滤', async () => {
  const { root, context, state, server } = await start(undefined, false, { cacheDir: 'pages/cache', build: { outDir: 'pages/output' } })
  const ignoredDirectories = ['pages/output', 'pages/cache'].map(directory => path.join(root, directory))
  for (const directory of ignoredDirectories) {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'ignored.vue'), '<template><view /></template>')
  }
  await Promise.all([waitForReady(state.pageWatcher.watcher!), waitForReady(server.watcher)])
  await settleUpdates(state)
  const watched = Object.keys(state.pageWatcher.watcher!.getWatched()).map(normalizePath)
  for (const directory of ignoredDirectories)
    expect(watched).not.toContain(normalizePath(directory))
  const updates = vi.spyOn(context, 'updatePagesJSON')

  for (const directory of ignoredDirectories)
    server.watcher.emit('change', path.join(directory, 'ignored.vue'))
  await settleUpdates(state)

  expect(updates).not.toHaveBeenCalled()
})
