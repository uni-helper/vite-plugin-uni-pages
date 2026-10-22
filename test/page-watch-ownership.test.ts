import type { FSWatcher, ServerOptions, ViteDevServer } from 'vite'
import type { UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { createServer, normalizePath } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'
import * as macro from '../packages/core/src/macro'

interface WatchState {
  pendingPageFlush?: Promise<void>
  pendingPageUpdate?: unknown
  pendingUpdate: Promise<void>
  pageWatcher: { watcher?: FSWatcher }
}

const roots: string[] = []
const contexts: PageContext[] = []
const servers: ViteDevServer[] = []

function fixture(): { workspace: string, root: string } {
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-ownership-')))
  roots.push(workspace)
  const root = path.join(workspace, 'app')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'pages.config.json'), '{}')
  return { workspace, root }
}

function page(file: string, title: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} } })</script>`)
}

function link(target: string, source: string): void {
  fs.symlinkSync(target, source, process.platform === 'win32' ? 'junction' : 'dir')
}

function output(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
}

async function ready(watcher: FSWatcher): Promise<void> {
  if (!(watcher as FSWatcher & { _readyEmitted: boolean })._readyEmitted)
    await new Promise<void>(resolve => watcher.once('ready', resolve))
}

async function flush(state: WatchState): Promise<void> {
  while (true) {
    const update = state.pendingUpdate
    await state.pendingPageFlush
    await update
    if (!state.pendingPageFlush && !state.pendingPageUpdate && update === state.pendingUpdate)
      return
  }
}

async function start(root: string, options: UserOptions = {}, watch?: ServerOptions['watch']) {
  if (process.platform === 'win32')
    vi.stubEnv('CHOKIDAR_USEPOLLING', 'true')
  vi.stubEnv('CHOKIDAR_INTERVAL', undefined)
  const context = new PageContext({ dir: 'pages', outDir: '.', dts: false, ...options }, root, 'h5')
  contexts.push(context)
  await context.updatePagesJSON()
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, watch } })
  servers.push(server)
  context.setupViteServer(server)
  const state = context as unknown as WatchState
  const events: { owner: string, event: string, file: string }[] = []
  const watchers = new Set<FSWatcher>()
  const track = (watcher: FSWatcher, owner: string): FSWatcher => {
    if (!watchers.has(watcher)) {
      watchers.add(watcher)
      watcher.on('all', (event, file) => events.push({ owner, event, file: normalizePath(file) }))
    }
    return watcher
  }
  track(server.watcher, 'shared')
  const owned = (): FSWatcher => {
    expect(state.pageWatcher.watcher).toBeDefined()
    return track(state.pageWatcher.watcher!, 'owned')
  }
  const updates = vi.spyOn(context, 'updatePagesJSON')
  const settle = async (): Promise<void> => {
    let previous = ''
    let quietSince = Date.now()
    await vi.waitFor(async () => {
      await ready(owned())
      await flush(state)
      const current = `${events.length}:${updates.mock.calls.length}`
      if (current !== previous) {
        previous = current
        quietSince = Date.now()
      }
      expect(Date.now() - quietSince, '原生事件与更新队列应先收敛').toBeGreaterThanOrEqual(250)
    }, { timeout: 10000, interval: 25 })
  }
  await Promise.all([ready(server.watcher), ready(owned())])
  await settle()
  events.length = 0
  updates.mockClear()
  return { context, server, events, updates, settle }
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

it('shared 与 owned 均收到保存事件时，目标页只读取解析一次，无关页不重读', async () => {
  const { root } = fixture()
  const file = normalizePath(path.join(root, 'pages/index.vue'))
  const unrelated = normalizePath(path.join(root, 'pages/unrelated.vue'))
  page(file, '初始')
  page(unrelated, '无关页')
  const { events, updates, settle } = await start(root)
  const reads = vi.spyOn(fs.promises, 'readFile')
  const parses = vi.spyOn(macro, 'evaluateDefinePage')

  page(file, '保存后')

  await vi.waitFor(() => {
    for (const owner of ['shared', 'owned'])
      expect(events).toContainEqual({ owner, event: 'change', file })
    expect(output(root).pages.find((entry: any) => entry.path === 'pages/index').style.navigationBarTitleText).toBe('保存后')
  }, { timeout: 10000 })
  await settle()
  expect(reads.mock.calls.filter(([read]) => normalizePath(String(read)) === file)).toHaveLength(1)
  expect(parses.mock.calls.filter(([, parsed]) => normalizePath(parsed) === file)).toHaveLength(1)
  expect(reads.mock.calls.filter(([read]) => normalizePath(String(read)) === unrelated)).toHaveLength(0)
  expect(parses.mock.calls.filter(([, parsed]) => normalizePath(parsed) === unrelated)).toHaveLength(0)
  expect(updates).toHaveBeenCalledExactlyOnceWith(file)
}, 20000)

it('root 外词法来源可更新被 Vite ignored 排除的 root 内物理目标', async () => {
  const { workspace, root } = fixture()
  const target = path.join(root, 'hidden-target')
  const source = path.join(workspace, 'alias')
  const file = normalizePath(path.join(target, 'index.vue'))
  page(file, '初始')
  link(target, source)
  const { server, events, settle } = await start(root, { subPackages: [{ dir: '../alias', root: 'feature' }] }, { ignored: '**/hidden-target/**' })
  expect(Object.keys(server.watcher.getWatched()).map(normalizePath)).not.toContain(normalizePath(target))

  page(file, '保存后')

  await vi.waitFor(() => expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('保存后'), { timeout: 10000 })
  await settle()
  expect(events).toContainEqual({ owner: 'owned', event: 'change', file })
  expect(events.filter(event => event.owner === 'shared' && event.file === file)).toEqual([])
}, 20000)

it('root 外词法入口改指 root 内目标后恢复页面及后续内容更新', async () => {
  const { workspace, root } = fixture()
  const previous = path.join(root, 'content-a')
  const target = path.join(root, 'content-b')
  const source = path.join(workspace, 'alias')
  page(path.join(previous, 'index.vue'), '旧目标')
  page(path.join(target, 'index.vue'), '新目标')
  link(previous, source)
  const { settle } = await start(root, { subPackages: [{ dir: '../alias', root: 'feature' }] })

  fs.unlinkSync(source)
  link(target, source)

  await vi.waitFor(() => expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('新目标'), { timeout: 10000 })
  await settle()
  page(path.join(target, 'index.vue'), '再次保存')
  await vi.waitFor(() => expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('再次保存'), { timeout: 10000 })
}, 20000)

it('exclude: [] 的页面来源链接进 node_modules 时仍监听内容', async () => {
  const { root } = fixture()
  const target = path.join(root, 'node_modules/@scope/ui/pages')
  const alias = path.join(root, 'src/alias')
  page(path.join(target, 'index.vue'), '初始')
  fs.mkdirSync(path.dirname(alias), { recursive: true })
  link(target, alias)
  const { updates, settle } = await start(root, { subPackages: ['src/alias'], exclude: [] })
  expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('初始')

  page(path.join(target, 'index.vue'), '更新')
  await vi.waitFor(() => expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('更新'), { timeout: 10000 })
  await settle()
  expect(updates).toHaveBeenCalledWith(normalizePath(path.join(alias, 'index.vue')))
}, 20000)
