import type { InlineConfig, Plugin, Rollup } from 'vite'
import type { UniPagesPlugin } from '../packages/core/src'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { build, createServer, resolveConfig } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'
import { PageContext } from '../packages/core/src/context'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []
const contexts = new Set<PageContext>()
const coreRequire = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { default: chokidar } = coreRequire('chokidar')

interface Routes {
  pages: { path: string }[]
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function closeHook(pages: UniPagesPlugin, name: 'closeWatcher' | 'closeBundle'): Promise<void> {
  const hook = pages[name]!
  const handler = typeof hook === 'function' ? hook : hook.handler
  return Promise.resolve(handler.call({} as never))
}

function fixture(title = '第一轮'): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-lifecycle-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view>首页</view></template>')
  fs.writeFileSync(path.join(root, 'src/pages/removed.vue'), '<template><view>旧页面</view></template>')
  fs.writeFileSync(path.join(root, 'entry.js'), 'export { pages, subPackages } from "virtual:uni-pages"')
  fs.writeFileSync(path.join(root, 'pages.config.json'), JSON.stringify({ globalStyle: { navigationBarTitleText: title } }))
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  return root
}

function updateFixture(root: string): void {
  fs.writeFileSync(path.join(root, 'pages.config.json'), JSON.stringify({ globalStyle: { navigationBarTitleText: '第二轮' } }))
  fs.unlinkSync(path.join(root, 'src/pages/removed.vue'))
  fs.writeFileSync(path.join(root, 'src/pages/detail.vue'), '<template><view>新页面</view></template>')
}

function config(root: string, pages: UniPagesPlugin, plugins: Plugin[] = []): InlineConfig {
  return {
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [pages, ...plugins],
    build: {
      minify: false,
      lib: { entry: path.join(root, 'entry.js'), formats: ['es'], fileName: () => 'entry.mjs' },
    },
  }
}

async function buildRoutes(root: string, pages: UniPagesPlugin, plugins: Plugin[] = []): Promise<Routes> {
  const built = await build(config(root, pages, plugins))
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result))
    throw new Error('Expected a completed build')
  const entry = result.output.find(output => output.type === 'chunk' && output.isEntry)
  if (!entry || entry.type !== 'chunk')
    throw new Error('Expected the virtual module in a built entry')
  return import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`)
}

async function startServer(root: string, pages: UniPagesPlugin) {
  const server = await createServer({
    ...config(root, pages),
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  closers.push(() => server.close())
  return server
}

async function startWatch(root: string, pages: UniPagesPlugin, watch: Rollup.WatcherOptions = {}) {
  const listening = deferred()
  const closedBundle = vi.fn()
  const options = config(root, pages, [{
    name: 'observe-completed-bundle',
    buildStart: () => listening.promise,
    closeBundle: closedBundle,
  }])
  const watcher = await build({ ...options, build: { ...options.build, watch } })
  if (Array.isArray(watcher) || !('on' in watcher))
    throw new Error('Expected a build watcher')
  closers.push(() => watcher.close())
  const nextEnd = () => new Promise<void>((resolve, reject) => {
    const onEvent = (event: Rollup.RollupWatcherEvent) => {
      if (event.code === 'END' || event.code === 'ERROR') {
        watcher.off('event', onEvent)
        if (event.code === 'END')
          resolve()
        else
          reject(event.error)
      }
    }
    watcher.on('event', onEvent)
  })
  const firstEnd = nextEnd()
  // 先登记结束事件，再允许首轮构建继续
  listening.resolve()
  await firstEnd
  expect(closedBundle).toHaveBeenCalledOnce()
  return { watcher, closedBundle, nextEnd }
}

function expectOutput(root: string, routes: Routes, title: string, expectedPages: string[]): void {
  const pages = parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as unknown as Routes & { globalStyle: { navigationBarTitleText: string } }
  const declaration = fs.readFileSync(path.join(root, 'uni-pages.d.ts'), 'utf8')
  expect({
    title: pages.globalStyle.navigationBarTitleText,
    pages: pages.pages.map(page => page.path).sort(),
    routes: routes.pages.map(page => page.path).sort(),
    declared: [...new Set([...declaration.matchAll(/"\/(pages\/[^"\n]+)"/g)].map(match => match[1]))].sort(),
  }).toEqual({ title, pages: expectedPages, routes: expectedPages, declared: expectedPages })
}

beforeEach(() => {
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(function (this: PageContext, watcher) {
    contexts.add(this)
    return setup.call(this, watcher)
  })
})

afterEach(async () => {
  for (const close of closers.splice(0))
    await close()
  for (const context of contexts)
    await context.disposeWatchers()
  contexts.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('插件实例生命周期', () => {
  it.each(['构建', '开发服务器', '构建监听'] as const)('%s 结束后顺序复用会重新读取配置和增删页面', async (mode) => {
    const root = fixture()
    const pages = UniPages()
    if (mode === '构建') {
      expectOutput(root, await buildRoutes(root, pages), '第一轮', ['pages/index', 'pages/removed'])
    }
    else if (mode === '开发服务器') {
      const server = await startServer(root, pages)
      expectOutput(root, await server.ssrLoadModule('virtual:uni-pages') as Routes, '第一轮', ['pages/index', 'pages/removed'])
      await server.close()
    }
    else {
      const { watcher } = await startWatch(root, pages)
      await watcher.close()
    }
    updateFixture(root)

    expectOutput(root, await buildRoutes(root, pages), '第二轮', ['pages/detail', 'pages/index'])
  })

  it('构建监听的两轮 closeBundle 都保留占用，整个 watcher 关闭后才能重新准备', async () => {
    const root = fixture()
    const pages = UniPages()
    const entry = path.join(root, 'entry.js')
    const watchFile = vi.spyOn(fs, 'watchFile')
    const { watcher, closedBundle, nextEnd } = await startWatch(root, pages, { chokidar: { usePolling: true, interval: 20 } })
    await vi.waitFor(() => expect(watchFile.mock.calls.some(([file]) => path.resolve(String(file)) === entry)).toBe(true))
    const rebuilt = nextEnd()

    fs.writeFileSync(entry, 'export { pages, subPackages } from "virtual:uni-pages"; export const round = 2')
    await rebuilt

    expect(closedBundle).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(root, 'dist/entry.mjs'), 'utf8')).toContain('round')
    await expect(buildRoutes(root, pages)).rejects.toThrow(/active|already|overlap/i)
    await watcher.close()
    updateFixture(root)
    expectOutput(root, await buildRoutes(root, pages), '第二轮', ['pages/detail', 'pages/index'])
  })

  it('未显式 prepare 的实例在构建结束后允许换 root', async () => {
    const root = fixture()
    const pages = UniPages()
    await buildRoutes(root, pages)
    const nextRoot = fixture('另一项目')
    fs.unlinkSync(path.join(nextRoot, 'src/pages/removed.vue'))

    expectOutput(nextRoot, await buildRoutes(nextRoot, pages), '另一项目', ['pages/index'])
  })

  it('未显式 prepare 的实例在构建结束后允许换平台', async () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<script setup>definePage(({ platform }) => ({ style: { navigationBarTitleText: platform } }))</script>')
    const pages = UniPages()
    await buildRoutes(root, pages)
    vi.stubEnv('UNI_PLATFORM', 'mp-weixin')

    const routes = await buildRoutes(root, pages)
    expect(routes.pages.find(page => page.path === 'pages/index')).toMatchObject({ style: { navigationBarTitleText: 'mp-weixin' } })
  })

  it('并发和重复 prepare 及首次真实构建共用一次准备', async () => {
    const root = fixture()
    const onBeforeLoadUserConfig = vi.fn()
    const pages = UniPages({ onBeforeLoadUserConfig })
    const first = pages.prepare({ root, platformSuffix: false })
    expect(pages.prepare({ root: path.join(root, 'src', '..'), platformSuffix: false })).toBe(first)
    await first
    expect(pages.prepare({ root, platformSuffix: false })).toBe(first)

    expectOutput(root, await buildRoutes(root, pages), '第一轮', ['pages/index', 'pages/removed'])
    expect(onBeforeLoadUserConfig).toHaveBeenCalledOnce()
  })

  describe.each(['构建结束后', '开发服务器活跃时'] as const)('%s 接受的 prepare', (timing) => {
    it.each(['root', 'platform', 'platformSuffix'] as const)('后续构建保留 %s 约束', async (changed) => {
      const root = fixture()
      const pages = UniPages()
      const server = timing === '开发服务器活跃时' ? await startServer(root, pages) : undefined
      if (!server)
        await buildRoutes(root, pages)
      await pages.prepare({ root, platformSuffix: false })
      await server?.close()
      await buildRoutes(root, pages)
      let nextRoot = root
      const plugins: Plugin[] = []
      if (changed === 'root')
        nextRoot = fixture('另一项目')
      else if (changed === 'platform')
        vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
      else
        plugins.push({ name: 'vite-plugin-uni-platform' })

      await expect(buildRoutes(nextRoot, pages, plugins)).rejects.toThrow(`${changed} does not match`)
    })
  })

  it.each(['开发服务器', '构建监听'] as const)('%s 活跃时拒绝复用，并保留原会话的虚拟模块', async (mode) => {
    const root = fixture()
    const pages = UniPages()
    const current = mode === '开发服务器' ? await startServer(root, pages) : (await startWatch(root, pages)).watcher
    await expect(buildRoutes(root, pages)).rejects.toThrow(/active|already|overlap/i)
    const nextRoot = fixture('另一项目')
    fs.writeFileSync(path.join(nextRoot, 'src/pages/other.vue'), '<template><view>另一项目</view></template>')

    await expect(buildRoutes(nextRoot, pages)).rejects.toThrow(/active|already|overlap/i)
    if ('ssrLoadModule' in current)
      expectOutput(root, await current.ssrLoadModule('virtual:uni-pages') as Routes, '第一轮', ['pages/index', 'pages/removed'])
    await current.close()
    expectOutput(nextRoot, await buildRoutes(nextRoot, pages), '另一项目', ['pages/index', 'pages/other', 'pages/removed'])
  })

  it('初始化被阻塞时拒绝重叠构建，且原构建继续使用自己的上下文', async () => {
    const root = fixture()
    const entered = deferred()
    const release = deferred()
    const parser = async (file: string) => {
      if (file.startsWith(root)) {
        entered.resolve()
        await release.promise
      }
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    const pages = UniPages({ configSource: { files: 'pages.config.json', extensions: [], parser } })
    const building = buildRoutes(root, pages)
    await entered.promise
    try {
      const nextRoot = fixture('另一项目')
      await expect(buildRoutes(nextRoot, pages)).rejects.toThrow(/active|already|overlap/i)
    }
    finally {
      release.resolve()
      await building
    }
    expectOutput(root, await building, '第一轮', ['pages/index', 'pages/removed'])
  })

  it('真实构建初始化失败后释放占用，同实例可以重新构建', async () => {
    const root = fixture()
    const parser = vi.fn()
      .mockRejectedValueOnce(new Error('配置加载失败'))
      .mockResolvedValue({ globalStyle: { navigationBarTitleText: '恢复后' } })
    const pages = UniPages({ configSource: { files: 'pages.config.json', extensions: [], parser } })

    await expect(buildRoutes(root, pages)).rejects.toThrow('配置加载失败')
    expectOutput(root, await buildRoutes(root, pages), '恢复后', ['pages/index', 'pages/removed'])
    expect(parser).toHaveBeenCalledTimes(2)
  })

  it.each(['closeBundle', 'closeWatcher'] as const)('初始化期间调用 %s 会等待释放，且不再启动监听', async (closingHook) => {
    const root = fixture()
    const entered = deferred()
    const release = deferred()
    const pages = UniPages({
      configSource: {
        files: 'pages.config.json',
        extensions: [],
        parser: async (file) => {
          entered.resolve()
          await release.promise
          return JSON.parse(fs.readFileSync(file, 'utf8'))
        },
      },
    })
    const options = config(root, pages)
    const resolved = await resolveConfig({ ...options, plugins: [], build: { ...options.build, watch: closingHook === 'closeWatcher' ? {} : null } }, 'build')
    const hook = pages.configResolved!
    const handler = typeof hook === 'function' ? hook : hook.handler
    const watch = vi.spyOn(chokidar, 'watch')
    // Vite 不会暴露尚未完成初始化的 server，这里只通过钩子注入提前关闭
    const configuring = Promise.resolve(handler(resolved)).then(() => undefined, error => error)
    await entered.promise
    const closing = closeHook(pages, closingHook)
    try {
      await expect(buildRoutes(root, pages)).rejects.toThrow(/active|already|overlap/i)
    }
    finally {
      release.resolve()
      await closing
    }
    expect(await configuring).toBeInstanceOf(Error)
    expect(await configuring).toHaveProperty('message', expect.stringContaining('closed'))
    expect(watch).not.toHaveBeenCalled()
    expectOutput(root, await buildRoutes(root, pages), '第一轮', ['pages/index', 'pages/removed'])
  })

  it('准备完成与 Vite 接管的微任务之间关闭时不再注册构建监听', async () => {
    const root = fixture()
    const entered = deferred()
    const release = deferred()
    const pages = UniPages({
      configSource: {
        files: 'pages.config.json',
        extensions: [],
        parser: async (file) => {
          entered.resolve()
          await release.promise
          return JSON.parse(fs.readFileSync(file, 'utf8'))
        },
      },
    })
    const options = config(root, pages)
    const resolved = await resolveConfig({ ...options, plugins: [], build: { ...options.build, watch: {} } }, 'build')
    const watch = vi.spyOn(chokidar, 'watch')
    const prepared = pages.prepare({ root, platformSuffix: false })
    // 先登记关闭回调，使其在 configResolved 恢复前开始释放
    const closing = prepared.then(() => closeHook(pages, 'closeWatcher'))
    const hook = pages.configResolved!
    const handler = typeof hook === 'function' ? hook : hook.handler
    const configuring = Promise.resolve(handler(resolved)).then(() => undefined, error => error)
    await entered.promise
    release.resolve()
    await closing

    expect(await configuring).toBeInstanceOf(Error)
    expect(watch).not.toHaveBeenCalled()
    expectOutput(root, await buildRoutes(root, pages), '第一轮', ['pages/index', 'pages/removed'])
  })
})
