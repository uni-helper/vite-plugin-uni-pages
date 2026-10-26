import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { FSWatcher, InlineConfig, ViteDevServer } from 'vite'
import type { MockInstance } from 'vitest'
import type { UserOptions } from '../../packages/core/src'
import type { FakeWatcher } from './page-watcher'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { createServer, normalizePath } from 'vite'
import { afterAll, afterEach, expect, vi } from 'vitest'
import { PageContext } from '../../packages/core/src'
import { createFakeWatcher, currentPageWatcher, flushPageUpdates, mockPageWatchers, pageWatchState } from './page-watcher'

/**
 * 测试夹具：临时工作区 + 受控 watcher + 收敛助手。
 *
 * 测试文件里反复出现的临时目录、页面/配置写入、私有字段强转和
 * `pendingUpdate` 轮询都收在这里。测试只通过和调用方相同的入口
 * （PageContext 的公开方法、chokidar 事件、pages.json 文本）断言，
 * 不再各自维护一套时序逻辑。
 */

export interface FixtureOptions {
  /**
   * 自动清理范围。
   *
   * 默认 `'test'`：每个用例结束后关闭该夹具创建的服务和上下文，
   * 删除临时目录。在 `beforeAll` 里创建、要跨用例复用的夹具传
   * `'file'`，等整个文件结束后再清理。
   */
  scope?: 'test' | 'file'
}

export interface PageWatchState {
  /** 页面内容监听是否已成功启动 */
  started: boolean
  /** 恢复入口（fs.watch / fs.watchFile）观察的目录 */
  recoveryPaths: string[]
}

export interface ControlledPageWatch {
  /** 模拟 Vite 共享 watcher，传给 context.setupWatcher */
  shared: FakeWatcher
  /** 当前自有页面 watcher，可能随重试被替换 */
  readonly page: FakeWatcher | undefined
  /** 向自有页面 watcher 派发事件 */
  emit: (event: string, file?: string) => void
  /** 向恢复入口派发事件 */
  emitEntrance: (file: string, event: string, ...args: unknown[]) => void
  /** 恢复入口对应的受控 watcher */
  entrance: (file: string) => FakeWatcher | undefined
  /** 等待页面更新队列收敛 */
  settle: () => Promise<void>
  /** 读取监听启动与恢复入口状态 */
  state: () => PageWatchState
}

export interface WatchEvent {
  owner: 'shared' | 'owned'
  event: string
  file: string
}

export interface ViteWatchProbe {
  /** 共享 watcher 与自有 watcher 收到的全部事件 */
  events: WatchEvent[]
  /** context.updatePagesJSON 的 spy */
  updates: MockInstance<PageContext['updatePagesJSON']>
  /** 清空启动阶段的事件和调用记录 */
  reset: () => void
  /** 等待真实 watcher 就绪、事件与更新队列安静下来 */
  settle: () => Promise<void>
}

export type PageDefinition = Record<string, unknown> | null

export interface TestFixture {
  /** 临时工作区根目录（真实路径） */
  readonly root: string
  /** 工作区内的绝对路径；不传返回根目录 */
  path: (relativePath?: string) => string
  /** 写入文本文件，自动创建父目录，返回绝对路径 */
  write: (relativePath: string, content: string) => string
  /**
   * 写入 .vue 页面。
   *
   * - 不传定义：只有模板
   * - 对象：`definePage({ ... })`
   * - `null`：`definePage(null)`
   * - 字符串：以 `<` 开头视为完整文件内容，否则视为 script 内容
   */
  writePage: (relativePath: string, definition?: PageDefinition | string) => string
  /** 写入 pages 配置；对象序列化为 JSON，字符串原样写入 */
  writeConfig: (value?: unknown, filename?: string) => string
  /** 读取文本文件 */
  read: (relativePath: string) => string
  /** 读取并解析 pages.json；可传上下文自动定位输出路径 */
  pagesJson: <T = PagesConfig>(source?: PageContext) => T
  remove: (relativePath: string) => void
  /** 创建符号链接；目录链接在 Windows 上退化为 junction */
  symlink: (target: string, linkPath: string, type?: 'file' | 'dir') => void
  /** 创建并跟踪 PageContext；projectRoot 相对工作区根目录，默认就是根目录 */
  context: (options?: UserOptions, platform?: string, projectRoot?: string) => PageContext
  /** 创建并跟踪 Vite server，同时注册到上下文 */
  vite: (context: PageContext, config?: InlineConfig) => Promise<ViteDevServer>
  /** 安装受控 watcher 并启动页面监听 */
  watch: (context: PageContext) => Promise<ControlledPageWatch>
  /** 当前自有页面 watcher（真实或受控） */
  watcher: (context: PageContext) => FSWatcher | undefined
  /** 等待页面更新队列收敛 */
  settle: (context: PageContext) => Promise<void>
  /** 读取监听启动与恢复入口状态 */
  watchState: (context: PageContext) => PageWatchState
  /** 等待共享 watcher 与自有 watcher 就绪 */
  ready: (context: PageContext, server?: ViteDevServer) => Promise<void>
  /** 只等待 Vite 共享 watcher 就绪（页面监听被禁用时使用） */
  readyServer: (server: ViteDevServer) => Promise<void>
  /** 观察真实 Vite 的共享/自有 watcher 事件并等待安静 */
  probeVite: (context: PageContext, server: ViteDevServer) => ViteWatchProbe
}

interface FixtureState {
  scope: 'test' | 'file'
  root: string
  contexts: PageContext[]
  servers: ViteDevServer[]
  entrances?: Map<string, FakeWatcher>
}

async function disposeState(state: FixtureState): Promise<void> {
  for (const context of state.contexts.splice(0).reverse())
    await context.disposeWatchers()
  for (const server of state.servers.splice(0).reverse())
    await server.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(state.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

const states: FixtureState[] = []

async function disposeFixtures(scope: 'test' | 'all'): Promise<void> {
  const pending = states.filter(state => scope === 'all' || state.scope === 'test')
  for (const state of pending.splice(0).reverse()) {
    states.splice(states.indexOf(state), 1)
    await disposeState(state)
  }
}

afterEach(async () => {
  await disposeFixtures('test')
})

afterAll(async () => {
  await disposeFixtures('all')
})

function renderPage(definition: PageDefinition | string | undefined): string {
  const template = '<template><view /></template>\n'
  if (definition === undefined)
    return template
  if (typeof definition === 'string') {
    if (definition.trimStart().startsWith('<'))
      return definition
    return `<script setup>${definition}</script>${template}`
  }
  if (definition === null)
    return `<script setup>definePage(null)</script>${template}`
  return `<script setup>definePage(${JSON.stringify(definition)})</script>${template}`
}

function isReady(watcher: FSWatcher): boolean {
  return Boolean((watcher as FSWatcher & { _readyEmitted?: boolean })._readyEmitted)
}

async function waitForReady(watcher: FSWatcher): Promise<void> {
  if (isReady(watcher))
    return
  await new Promise<void>(resolve => watcher.once('ready', resolve))
}

/**
 * 创建一个临时工作区。
 *
 * 默认每个用例结束自动清理；在 `beforeAll` 里创建时传
 * `{ scope: 'file' }`，避免第一个用例结束时把后续用例的根目录删掉。
 */
export function createFixture(prefix = 'uni-pages-', options: FixtureOptions = {}): TestFixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const state: FixtureState = {
    scope: options.scope ?? 'test',
    root,
    contexts: [],
    servers: [],
  }
  states.push(state)

  function ensureWatchers(): Map<string, FakeWatcher> {
    if (!state.entrances)
      state.entrances = mockPageWatchers().entrances as Map<string, FakeWatcher>
    return state.entrances
  }

  const fixture: TestFixture = {
    root,
    path(relativePath = '') {
      return path.resolve(root, relativePath)
    },
    write(relativePath, content) {
      const file = fixture.path(relativePath)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content, 'utf8')
      return file
    },
    writePage(relativePath, definition) {
      return fixture.write(relativePath, renderPage(definition))
    },
    writeConfig(value = {}, filename = 'pages.config.json') {
      return fixture.write(filename, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    },
    read(relativePath) {
      return fs.readFileSync(fixture.path(relativePath), 'utf8')
    },
    pagesJson<T = PagesConfig>(source?: PageContext): T {
      const file = source ? source.resolvedPagesJSONPath : fixture.path('src/pages.json')
      return parse(fs.readFileSync(file, 'utf8')) as T
    },
    remove(relativePath) {
      fs.rmSync(fixture.path(relativePath), { recursive: true, force: true })
    },
    symlink(target, linkPath, type = 'dir') {
      const absoluteTarget = path.isAbsolute(target) ? target : fixture.path(target)
      const absoluteLink = path.isAbsolute(linkPath) ? linkPath : fixture.path(linkPath)
      fs.mkdirSync(path.dirname(absoluteLink), { recursive: true })
      fs.symlinkSync(absoluteTarget, absoluteLink, process.platform === 'win32' && type === 'dir' ? 'junction' : type)
    },
    context(contextOptions = {}, platform = 'h5', projectRoot = '.') {
      const context = new PageContext({ dts: false, ...contextOptions }, path.resolve(root, projectRoot), platform)
      state.contexts.push(context)
      return context
    },
    async vite(context, config = {}) {
      if (state.entrances)
        throw new Error('fixture.vite() 与 fixture.watch() 不能共用；真实 watcher 用例请另建夹具')
      const server = await createServer({
        root: context.options.root,
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        ...config,
        server: { middlewareMode: true, ...config.server },
      })
      state.servers.push(server)
      context.setupViteServer(server)
      return server
    },
    async watch(context) {
      if (state.servers.length)
        throw new Error('fixture.watch() 与 fixture.vite() 不能共用；受控 watcher 用例请另建夹具')
      const entrances = ensureWatchers()
      const shared = createFakeWatcher()
      await context.setupWatcher(shared as unknown as Parameters<PageContext['setupWatcher']>[0])
      const initial = currentPageWatcher(context)
      return {
        shared,
        get page() {
          return currentPageWatcher(context)
        },
        emit(event, file) {
          // 刷新后当前 watcher 可能被替换或暂时为空；像调用方一样回退到
          // 启动时的实例，仍能派发“已脱离来源”的事件
          const watcher = currentPageWatcher(context) ?? initial
          if (!watcher)
            throw new Error('页面 watcher 尚未启动；需要只派发共享 watcher 事件时用 watch.shared')
          watcher.emit(event, file)
        },
        emitEntrance(file, event, ...args) {
          entrances.get(normalizePath(file))?.emit(event, ...args)
        },
        entrance(file) {
          return entrances.get(normalizePath(file))
        },
        settle: () => flushPageUpdates(context),
        state: () => fixture.watchState(context),
      }
    },
    watcher(context) {
      return pageWatchState(context).watcher as unknown as FSWatcher | undefined
    },
    settle(context) {
      return flushPageUpdates(context)
    },
    watchState(context) {
      const state = pageWatchState(context)
      return { started: state.started, recoveryPaths: [...state.recoveryWatchers.keys()] }
    },
    async ready(context, server) {
      const owned = (): FSWatcher | undefined => fixture.watcher(context)
      await vi.waitFor(() => {
        expect(owned()).toBeDefined()
      })
      if ((owned() as unknown as FakeWatcher | undefined)?.__controlled)
        throw new Error('受控 watcher 没有真实就绪事件；请改用 watch.settle()')
      const watchers = [server?.watcher, owned()].filter((watcher): watcher is FSWatcher => Boolean(watcher))
      await Promise.all(watchers.map(watcher => waitForReady(watcher)))
    },
    async readyServer(server) {
      await waitForReady(server.watcher)
    },
    probeVite(context, server) {
      const events: WatchEvent[] = []
      const tracked = new Set<FSWatcher>()
      const track = (watcher: FSWatcher | undefined, owner: WatchEvent['owner']): FSWatcher | undefined => {
        if (!watcher || tracked.has(watcher))
          return watcher
        tracked.add(watcher)
        watcher.on('all', (event, file) => events.push({ owner, event, file: normalizePath(file) }))
        return watcher
      }
      track(server.watcher, 'shared')
      const updates = vi.spyOn(context, 'updatePagesJSON')
      const owned = (): FSWatcher | undefined => track(fixture.watcher(context), 'owned')
      const settle = async (): Promise<void> => {
        let previous = ''
        let quietSince = Date.now()
        await vi.waitFor(async () => {
          await fixture.ready(context, server)
          owned()
          await flushPageUpdates(context)
          const current = `${events.length}:${updates.mock.calls.length}`
          if (current !== previous) {
            previous = current
            quietSince = Date.now()
          }
          expect(Date.now() - quietSince, '原生事件与更新队列应先收敛').toBeGreaterThanOrEqual(250)
        }, { timeout: 10000, interval: 25 })
      }
      return {
        events,
        updates,
        reset() {
          events.length = 0
          updates.mockClear()
        },
        settle,
      }
    },
  }

  return fixture
}
