import type { Buffer } from 'node:buffer'
import type { EventEmitter } from 'node:events'
import type { FSWatcher } from 'vite'
import type { UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { build, createServer, normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'
import { isPageDirectoryEvent, isPageFileInDirectories } from '../packages/core/src/directories'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

const roots: string[] = []
const closers: (() => Promise<unknown>)[] = []
function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-glob-watch-')))
  roots.push(root)
  return root
}
function page(root: string, name: string, title = name): void {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} } })</script><template><view /></template>`)
}
function read(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
}
function watchedFiles(watcher: FSWatcher, directory: string): string[] | undefined {
  return Object.entries(watcher.getWatched()).find(([dir]) => normalizePath(dir) === normalizePath(directory))?.[1]
}
interface WatchContext {
  pendingPageFlush: Promise<void> | undefined
  pendingUpdate: Promise<void>
  pendingPageUpdate: unknown
  pageWatcher: {
    watcher?: FSWatcher
    recoveryWatchers: Map<string, { watcher: EventEmitter }>
  }
}

/** 用独立哨兵确认非递归目录入口已就绪 */
async function waitForWatchDirectories(context: WatchContext): Promise<void> {
  for (const [directory, { watcher }] of context.pageWatcher.recoveryWatchers) {
    const prefix = `.watch-ready-${Math.random().toString(36).slice(2)}-`
    let subscribed = false
    const sentinels: string[] = []
    const onChange = (event: string | fs.Stats, previous: string | Buffer | fs.Stats | null): void => {
      if (typeof event === 'string') {
        if (previous?.toString().startsWith(prefix))
          subscribed = true
      }
      else if (sentinels.length && previous && typeof previous === 'object' && 'mtimeMs' in previous) {
        subscribed ||= event.mtimeMs !== previous.mtimeMs
      }
    }
    watcher.on('change', onChange)
    try {
      await vi.waitFor(() => {
        const sentinel = path.join(directory, `${prefix}${sentinels.length}`)
        sentinels.push(sentinel)
        fs.writeFileSync(sentinel, '')
        expect(subscribed, `目录入口监听尚未就绪 ${directory}`).toBe(true)
      }, { timeout: 10000, interval: 100 })
    }
    finally {
      watcher.off('change', onChange)
      for (const sentinel of sentinels)
        fs.rmSync(sentinel, { force: true })
    }
  }
}

/** 哨兵只验证当前内容订阅，不改写待测页面 */
async function waitForContentSubscription(watcher: FSWatcher, directory: string): Promise<void> {
  const prefix = `.content-ready-${Math.random().toString(36).slice(2)}-`
  const sentinels: string[] = []
  let subscribed = false
  const onAll = (_event: string, file: string): void => {
    if (normalizePath(file).startsWith(normalizePath(path.join(directory, prefix))))
      subscribed = true
  }
  watcher.on('all', onAll)
  try {
    await vi.waitFor(() => {
      const sentinel = path.join(directory, `${prefix}${sentinels.length}`)
      sentinels.push(sentinel)
      fs.writeFileSync(sentinel, '')
      expect(subscribed, `页面内容监听尚未就绪 ${directory}`).toBe(true)
    }, { timeout: 10000, interval: 100 })
  }
  finally {
    watcher.off('all', onAll)
    for (const sentinel of sentinels)
      fs.rmSync(sentinel, { force: true })
  }
}
async function waitForPackages(root: string, expected: string[]): Promise<void> {
  await vi.waitFor(() => expect((read(root).subPackages ?? []).map((pkg: any) => pkg.root)).toEqual(expected), { timeout: 10000, interval: 25 })
}
afterEach(async () => {
  for (const close of closers.splice(0).reverse())
    await close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const options: UserOptions = {
  outDir: '.',
  dts: false,
  dir: 'main/*/pages',
  subPackages: [{ dir: 'nested/deep/packages/*/pages', root: dir => path.posix.dirname(dir) }],
}

async function start(root: string, mode: 'serve' | 'build', overrides: UserOptions = {}) {
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  fs.writeFileSync(path.join(root, 'pages.config.json'), JSON.stringify({ pages: [{ path: 'home', type: 'home' }] }))
  let scans = 0
  const updates = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  let observedWatcher: FSWatcher | undefined
  let context: WatchContext
  const events: string[] = []
  const contentWatchers = new Set<FSWatcher>()
  const contentWatcher = (): FSWatcher | undefined => {
    const watcher = context.pageWatcher.watcher
    if (watcher && !contentWatchers.has(watcher)) {
      contentWatchers.add(watcher)
      watcher.on('all', (event, file) => events.push(`${event}:${normalizePath(path.relative(root, file))}`))
    }
    return watcher
  }
  const setup = PageContext.prototype.setupWatcher
  const setupSpy = vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(function (this: PageContext, watcher) {
    observedWatcher = watcher as unknown as FSWatcher
    context = this as unknown as WatchContext
    const pending = setup.call(this, watcher)
    contentWatcher()
    return pending
  })
  const settle = async (): Promise<void> => {
    let snapshot = ''
    let quietSince = Date.now()
    await vi.waitFor(async () => {
      contentWatcher()
      while (true) {
        const update = context.pendingUpdate
        await context.pendingPageFlush
        await update
        if (!context.pendingPageFlush && !context.pendingPageUpdate && update === context.pendingUpdate)
          break
      }
      contentWatcher()
      const current = `${events.length}:${updates.mock.calls.length}`
      if (snapshot !== current) {
        snapshot = current
        quietSince = Date.now()
      }
      expect(Date.now() - quietSince).toBeGreaterThanOrEqual(250)
    }, { timeout: 10000, interval: 50 })
  }
  const readyContent = async (directory: string): Promise<FSWatcher> => {
    await vi.waitFor(() => expect(contentWatcher()).toBeDefined(), { timeout: 10000 })
    const watcher = contentWatcher()!
    await waitForContentSubscription(watcher, directory)
    await settle()
    expect(contentWatcher()).toBe(watcher)
    return watcher
  }
  const readyEntrances = async (): Promise<void> => {
    await waitForWatchDirectories(context)
    await settle()
  }
  const plugin = UniPages({
    ...options,
    ...overrides,
    onAfterScanPages: (pages, subPages) => {
      scans++
      overrides.onAfterScanPages?.(pages, subPages)
    },
  })
  if (mode === 'serve') {
    const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', plugins: [plugin], server: { middlewareMode: true } })
    const close = () => server.close()
    closers.push(close)
    await vi.waitFor(() => expect(scans).toBeGreaterThanOrEqual(2), { timeout: 10000 })
    await vi.waitFor(() => expect(watchedFiles(observedWatcher!, root)).toContain('pages.config.json'), { timeout: 10000 })
    await waitForWatchDirectories(context!)
    await settle()
    setupSpy.mockRestore()
    return { close, watcher: observedWatcher!, contentWatcher, readyContent, readyEntrances, events, settle }
  }
  fs.writeFileSync(path.join(root, 'entry.js'), 'export const example = 1')
  const watcher = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [plugin],
    build: { watch: {}, outDir: 'dist', lib: { entry: path.join(root, 'entry.js'), formats: ['es'], fileName: 'entry' } },
  })
  if (Array.isArray(watcher) || !('close' in watcher))
    throw new Error('Expected a Rollup watcher')
  const close = () => watcher.close()
  closers.push(close)
  await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'dist/entry.mjs'))).toBe(true), { timeout: 10000 })
  await vi.waitFor(() => expect(scans).toBeGreaterThanOrEqual(2), { timeout: 10000 })
  await vi.waitFor(() => expect(watchedFiles(observedWatcher!, root)).toContain('pages.config.json'), { timeout: 10000 })
  await waitForWatchDirectories(context!)
  await settle()
  setupSpy.mockRestore()
  return { close, watcher: observedWatcher!, contentWatcher, readyContent, readyEntrances, events, settle }
}

describe.each(['serve', 'build'] as const)('%s 真实目录监听', (mode) => {
  it('发现多级缺失目录，并处理新增、删除、重建和页面元数据修改', async () => {
    const root = fixture()
    let foundEmptyDirectory = false
    const { contentWatcher, readyContent, readyEntrances, events, settle } = await start(root, mode, {
      onAfterScanPages: (_, subPages) => {
        foundEmptyDirectory ||= subPages.has('nested/deep/packages/account/pages')
      },
    })
    await waitForPackages(root, [])
    fs.mkdirSync(path.join(root, 'nested/deep/packages/account/pages'), { recursive: true })
    await vi.waitFor(() => expect(foundEmptyDirectory).toBe(true), { timeout: 10000, interval: 25 })
    await waitForPackages(root, [])
    const directory = path.join(root, 'nested/deep/packages/account/pages')
    const initialWatcher = await readyContent(directory)
    events.length = 0
    page(root, 'nested/deep/packages/account/pages/profile.vue', '初始')
    await waitForPackages(root, ['nested/deep/packages/account'])
    expect(read(root).subPackages[0].pages[0].path).toBe('pages/profile')
    await vi.waitFor(() => expect(events).toContain('add:nested/deep/packages/account/pages/profile.vue'), { timeout: 10000 })
    await fs.promises.rm(path.join(root, 'nested'), { recursive: true, maxRetries: 10, retryDelay: 50 })
    await waitForPackages(root, [])
    await settle()
    expect(initialWatcher.getWatched()).toEqual({})
    expect(contentWatcher()).toBeUndefined()
    await readyEntrances()
    events.length = 0
    page(root, 'nested/deep/packages/account/pages/profile.vue', '重建')
    page(root, 'nested/deep/packages/account/pages/detail.vue', '详情')
    await waitForPackages(root, ['nested/deep/packages/account'])
    await vi.waitFor(() => expect(read(root).subPackages[0].pages).toHaveLength(2), { timeout: 10000 })
    const restoredWatcher = await readyContent(directory)
    expect(watchedFiles(restoredWatcher, directory)).toEqual(expect.arrayContaining(['profile.vue', 'detail.vue']))
    events.length = 0
    page(root, 'nested/deep/packages/account/pages/profile.vue', '修改一')
    page(root, 'nested/deep/packages/account/pages/detail.vue', '修改二')
    await vi.waitFor(() => expect(read(root).subPackages[0].pages.map((page: any) => page.style.navigationBarTitleText).sort()).toEqual(['修改一', '修改二']), { timeout: 10000 })
    await vi.waitFor(() => {
      expect(events).toContain('change:nested/deep/packages/account/pages/profile.vue')
      expect(events).toContain('change:nested/deep/packages/account/pages/detail.vue')
    }, { timeout: 10000 })
    page(root, 'main/account/pages/index.vue')
    await vi.waitFor(() => expect(read(root).pages.some((page: any) => page.path === 'main/account/pages/index')).toBe(true), { timeout: 10000 })
  }, 30000)

  it('目录重命名后重新发现分包，Windows 使用 polling 后端', async () => {
    // Chokidar 原生监听会锁住 Windows 子目录，阻止父目录重命名（上游 #1380）
    if (process.platform === 'win32')
      vi.stubEnv('CHOKIDAR_USEPOLLING', 'true')
    const root = fixture()
    page(root, 'nested/deep/packages/account/pages/profile.vue', '改名前')
    const { readyContent, events, settle } = await start(root, mode)
    await waitForPackages(root, ['nested/deep/packages/account'])
    const initialWatcher = await readyContent(path.join(root, 'nested/deep/packages/account/pages'))
    await fs.promises.rename(path.join(root, 'nested/deep/packages/account'), path.join(root, 'nested/deep/packages/profile'))
    await waitForPackages(root, ['nested/deep/packages/profile'])
    expect(read(root).subPackages[0].pages[0].path).toBe('pages/profile')
    await settle()
    expect(initialWatcher.getWatched()).toEqual({})
    await readyContent(path.join(root, 'nested/deep/packages/profile/pages'))
    events.length = 0
    page(root, 'nested/deep/packages/profile/pages/profile.vue', '改名后修改')
    await vi.waitFor(() => expect(read(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('改名后修改'), { timeout: 10000 })
    await vi.waitFor(() => expect(events).toContain('change:nested/deep/packages/profile/pages/profile.vue'), { timeout: 10000 })
  }, 30000)

  it('关闭后不再更新 pages.json', async () => {
    const root = fixture()
    const { close } = await start(root, mode)
    page(root, 'nested/deep/packages/account/pages/profile.vue')
    await waitForPackages(root, ['nested/deep/packages/account'])
    await close()
    closers.splice(closers.indexOf(close), 1)
    const before = fs.readFileSync(path.join(root, 'pages.json'), 'utf8')
    page(root, 'nested/deep/packages/order/pages/list.vue')
    // 负向断言需给文件系统事件足够时间，确认已关闭的 watcher 没有继续生成
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(fs.readFileSync(path.join(root, 'pages.json'), 'utf8')).toBe(before)
  }, 30000)

  it('发现项目根以外新增的多级目录', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    fs.mkdirSync(root)
    const unrelated = path.join(workspace, 'other-project')
    page(unrelated, 'src/index.vue')
    const { watcher, contentWatcher, settle } = await start(root, mode, { subPackages: ['../external/deep/*/pages'] })
    const expectScope = (): void => {
      for (const observed of [watcher, contentWatcher()].filter((value): value is FSWatcher => !!value))
        expect(Object.keys(observed.getWatched()).map(normalizePath).filter(directory => directory === normalizePath(unrelated) || directory.startsWith(`${normalizePath(unrelated)}/`)), '多级入口发现不应递归监听无关项目').toEqual([])
    }
    expectScope()
    page(workspace, 'external/deep/account/pages/profile.vue')
    await waitForPackages(root, ['../external/deep/account/pages'])
    await settle()
    expect(read(root).subPackages[0].pages[0].path).toBe('profile')
    expectScope()
  }, 30000)
})

describe('目录监听边界', () => {
  it('页面目录和排除项使用目录边界，不接受相邻前缀', () => {
    const root = fixture()
    const ctx = new PageContext({ dir: 'src/pages', subPackages: ['src/packages/*/pages'], exclude: ['**/hidden/**', '**/__*__/**'] }, root)
    expect(isPageFileInDirectories(path.join(root, 'src/pages-sub/a.vue'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(path.join(root, 'src/packages/account/pages/a.vue'), ctx.options)).toBe(true)
    expect(isPageFileInDirectories(path.join(root, 'src/packages/hidden/pages/a.vue'), ctx.options)).toBe(false)
    expect(isPageFileInDirectories(path.join(root, 'src/packages/account/pages/__private__/a.vue'), ctx.options)).toBe(false)
    expect(isPageDirectoryEvent(path.join(root, 'src/packages/hidden/pages'), ctx.options)).toBe(false)
    expect(isPageDirectoryEvent(path.join(root, 'src/components'), ctx.options)).toBe(false)
  })

  it('项目根外的缺失目录仍按当前规则识别页面路径', () => {
    const root = fixture()
    const app = path.join(root, 'app')
    fs.mkdirSync(app)
    const ctx = new PageContext({ dir: 'pages', subPackages: ['../external/deep/*/pages'] }, app)
    expect(isPageFileInDirectories(path.join(root, 'external/deep/account/pages/a.vue'), ctx.options)).toBe(true)
  })

  it('完整生成串行执行并保留随后修改页面的 filepath', async () => {
    const root = fixture()
    page(root, 'pages/a.vue', '旧 A')
    page(root, 'pages/b.vue', '旧 B')
    const ctx = new PageContext({ dir: 'pages', outDir: '.', dts: false }, root, 'h5')
    await ctx.updatePagesJSON()
    const load = ctx.loadUserPagesConfig.bind(ctx)
    let running = 0
    let maximum = 0
    vi.spyOn(ctx, 'loadUserPagesConfig').mockImplementation(async () => {
      running++
      maximum = Math.max(maximum, running)
      await load()
      await new Promise(resolve => setTimeout(resolve, 10))
      running--
    })
    page(root, 'pages/a.vue', '新 A')
    page(root, 'pages/b.vue', '新 B')
    await Promise.all([
      ctx.updatePagesJSON(),
      ctx.updatePagesJSON(normalizePath(path.join(root, 'pages/a.vue'))),
      ctx.updatePagesJSON(normalizePath(path.join(root, 'pages/b.vue'))),
    ])
    expect(maximum).toBe(1)
    expect(read(root).pages.map((page: any) => page.style.navigationBarTitleText).sort()).toEqual(['新 A', '新 B'])
  })

  it('解绑后共享 Vite watcher 仍可服务其他监听者', async () => {
    const root = fixture()
    page(root, 'pages/existing.vue')
    const ctx = new PageContext({ dir: 'pages', outDir: '.', dts: false }, root, 'h5')
    await ctx.updatePagesJSON()
    let ready = false
    const server = await createServer({
      root,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [{
        name: 'observe-watcher-ready',
        configureServer(server) {
          server.watcher.on('ready', () => {
            ready = true
          })
        },
      }],
    })
    closers.push(() => server.close())
    ctx.setupViteServer(server)
    await vi.waitFor(() => expect(ready).toBe(true))
    await vi.waitFor(() => expect(watchedFiles(server.watcher, path.join(root, 'pages'))).toContain('existing.vue'), { timeout: 10000 })
    const onAdd = vi.fn()
    server.watcher.on('add', onAdd)
    await ctx.disposeWatchers()
    const before = fs.readFileSync(path.join(root, 'pages.json'), 'utf8')
    page(root, 'pages/a.vue')
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled(), { timeout: 10000 })
    expect(fs.readFileSync(path.join(root, 'pages.json'), 'utf8')).toBe(before)
  })

  it('独立 build watcher 不监听 pages.json 的临时锁目录', async () => {
    const root = fixture()
    const { watcher } = await start(root, 'build')
    const lockDirectory = path.join(root, 'pages.json.lock')
    fs.mkdirSync(lockDirectory)
    fs.writeFileSync(path.join(lockDirectory, 'marker'), '')
    fs.writeFileSync(path.join(root, 'watch-sentinel.js'), '')
    await vi.waitFor(() => expect(watchedFiles(watcher, root)).toContain('watch-sentinel.js'), { timeout: 10000 })
    expect(Object.keys(watcher.getWatched()).map(normalizePath)).not.toContain(normalizePath(lockDirectory))
  })
})
