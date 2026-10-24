import type { ViteDevServer } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build, createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'

const roots: string[] = []

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(name: string): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-close-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, `src/pages/${name}.vue`), '<template><view /></template>')
  fs.writeFileSync(path.join(root, 'entry.js'), 'export { pages } from "virtual:uni-pages"')
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('构建监听关闭后的迟到钩子', () => {
  it.each([
    { ssr: false, failAtEnd: false },
    { ssr: false, failAtEnd: true },
    { ssr: true, failAtEnd: false },
    { ssr: true, failAtEnd: true },
  ])('旧构建恢复后不读取或释放新会话，SSR：$ssr，buildEnd 抛错：$failAtEnd', async ({ ssr, failAtEnd }) => {
    const root = fixture('alpha')
    const nextRoot = fixture('beta')
    vi.stubEnv('UNI_PLATFORM', 'h5')
    vi.stubEnv('VITE_ROOT_DIR', root)
    const pages = UniPages({ dts: false, homePage: ['pages/alpha', 'pages/beta'] })
    const entered = deferred()
    const resume = deferred()
    const ended = deferred()
    const closed = deferred()
    const oldModuleCode: string[] = []
    const watcher = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [pages, {
        name: 'gate-closing-build',
        buildStart: {
          order: 'pre',
          sequential: true,
          async handler() {
            entered.resolve()
            await resume.promise
          },
        },
        transform(code, id) {
          if (id === '\0virtual:uni-pages')
            oldModuleCode.push(code)
        },
        buildEnd() {
          ended.resolve()
          if (failAtEnd)
            throw new Error('旧构建结束失败')
        },
        closeBundle: {
          sequential: true,
          handler() {
            closed.resolve()
          },
        },
      }],
      build: { ssr, watch: {}, lib: { entry: path.join(root, 'entry.js'), formats: ['es'] } },
    })
    if (Array.isArray(watcher) || !('on' in watcher))
      throw new Error('Expected a build watcher')
    let server: ViteDevServer | undefined
    try {
      await entered.promise
      await watcher.close()
      server = await createServer({
        root: nextRoot,
        configFile: false,
        logLevel: 'silent',
        plugins: [pages],
        server: { middlewareMode: true, watch: null, hmr: false },
      })

      resume.resolve()
      await ended.promise
      if (failAtEnd)
        await closed.promise

      const routes = await server.ssrLoadModule('virtual:uni-pages')
      expect(routes.pages).toMatchObject([{ path: 'pages/beta' }])
      expect(oldModuleCode.join('\n')).not.toContain('pages/beta')
    }
    finally {
      resume.resolve()
      await ended.promise
      await server?.close()
      await watcher.close()
    }
  })

  it('关闭前已排队的下一轮构建始终属于原监听会话', async () => {
    const root = fixture('alpha')
    const nextRoot = fixture('beta')
    vi.stubEnv('UNI_PLATFORM', 'h5')
    vi.stubEnv('VITE_ROOT_DIR', root)
    const pages = UniPages({ dts: false, homePage: ['pages/alpha', 'pages/beta'] })
    const secondStarted = deferred()
    const invalidated = deferred()
    const resume = deferred()
    const thirdClosed = deferred()
    const oldModuleCode: string[] = []
    let generation = 0
    const watchFile = vi.spyOn(fs, 'watchFile')
    const watcher = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [pages, {
        name: 'gate-queued-build',
        buildStart: {
          order: 'pre',
          sequential: true,
          async handler() {
            generation++
            if (generation === 2) {
              secondStarted.resolve()
              await resume.promise
            }
          },
        },
        transform(code, id) {
          if (id === '\0virtual:uni-pages')
            oldModuleCode.push(code)
        },
        buildEnd() {
          if (generation === 3)
            throw new Error('旧监听的排队构建失败')
        },
        closeBundle: {
          sequential: true,
          handler() {
            if (generation === 3)
              thirdClosed.resolve()
          },
        },
      }],
      build: {
        watch: {
          chokidar: { usePolling: true, interval: 20 },
          onInvalidate() {
            if (generation === 2)
              invalidated.resolve()
          },
        },
        lib: { entry: path.join(root, 'entry.js'), formats: ['es'] },
      },
    })
    if (Array.isArray(watcher) || !('on' in watcher))
      throw new Error('Expected a build watcher')
    let server: ViteDevServer | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        watcher.on('event', (event) => {
          if (event.code === 'END' && generation === 1)
            resolve()
          else if (event.code === 'ERROR')
            reject(event.error)
        })
      })
      const entry = path.join(root, 'entry.js')
      await vi.waitFor(() => expect(watchFile.mock.calls.map(([file]) => path.resolve(String(file)))).toContain(entry))
      fs.appendFileSync(entry, '\n// first update')
      await secondStarted.promise
      // 越过 chokidar 的 50 ms change 节流窗口，再提交下一次独立修改
      await delay(60)
      fs.appendFileSync(entry, '\n// queued update')
      await invalidated.promise
      await watcher.close()
      server = await createServer({
        root: nextRoot,
        configFile: false,
        logLevel: 'silent',
        plugins: [pages],
        server: { middlewareMode: true, watch: null, hmr: false },
      })

      resume.resolve()
      await thirdClosed.promise
      expect(generation).toBe(3)
      const routes = await server.ssrLoadModule('virtual:uni-pages')
      expect(routes.pages).toMatchObject([{ path: 'pages/beta' }])
      expect(oldModuleCode.join('\n')).not.toContain('pages/beta')
    }
    finally {
      resume.resolve()
      await server?.close()
      await watcher.close()
    }
  })
})
