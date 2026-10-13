import type { FSWatcher } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'comment-json'
import { build, createServer, normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'
import { normalizeConfigPath } from '../packages/core/src/config-loader'
import { PageContext } from '../packages/core/src/context'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

/** chokidar 丢弃同一路径 50 ms 内的重复 change，重试前必须等过这个窗口 */
const CHANGE_THROTTLE_MS = 60

let root: string
let close: (() => Promise<unknown>) | undefined
const write = (file: string, content: string): void => fs.writeFileSync(path.join(root, file), content)
const output = (): any => parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8'))
async function waitTitle(title: string): Promise<void> {
  await vi.waitFor(() => expect(output().globalStyle.navigationBarTitleText).toBe(title), { timeout: 10000, interval: 20 })
}

beforeEach(() => {
  vi.stubEnv('UNI_PLATFORM', 'h5')
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-deps-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  write('package.json', '{"type":"module"}')
  write('src/pages/index.vue', '<template><view/></template>')
  write('entry.js', 'export const value = 1')
  write('pages.config.ts', `import { title } from './leaf.ts'; export default { globalStyle: { navigationBarTitleText: title } }`)
  write('leaf.ts', `export const title = 'initial'`)
  vi.stubEnv('VITE_ROOT_DIR', root)
})
afterEach(async () => {
  await close?.()
  close = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

interface WatcherSession {
  watcher: FSWatcher
  scheduledUpdates: () => number
  registrationCount: () => number
  settleUpdates: () => Promise<void>
  save: (file: string, content: string, stage?: string) => Promise<void>
  remove: (file: string) => Promise<void>
}

async function start(mode: 'dev' | 'build', extraFiles: string[] = []): Promise<WatcherSession> {
  const updates = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  const settleUpdates = async (): Promise<void> => {
    await Promise.allSettled(updates.mock.results.map(result => result.value))
  }
  let watched: FSWatcher | undefined
  let registrationCount = (): number => 0
  const history = new Map<string, object[]>()
  const record = (kind: string, event: string, file: string, watchedPath?: string): void => {
    const key = path.basename(file)
    const events = history.get(key) || []
    events.push({ time: Math.round(performance.now()), kind, event, file: normalizePath(file), watchedPath })
    history.set(key, events.slice(-20))
  }
  const diagnose = (stage: string, file: string): string => {
    const absolute = normalizePath(path.join(root, file))
    const parent = normalizePath(path.dirname(absolute))
    const entries = Object.entries(watched!.getWatched())
      .filter(([directory]) => normalizePath(directory) === parent)
    return JSON.stringify({
      stage,
      file: absolute,
      exists: fs.existsSync(absolute),
      parentEntries: entries,
      events: history.get(path.basename(file)) || [],
    })
  }
  let ready!: () => void
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve
  })
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(async function (this: PageContext, watcher) {
    watched = watcher as unknown as FSWatcher
    const add = vi.spyOn(watched, 'add')
    registrationCount = () => add.mock.calls.length
    watched.on('all', (event, file) => record('all', event, file))
    watched.on('raw', (event, file, details) => record('raw', event, file, details?.watchedPath))
    watched.once('ready', ready)
    const result = setup.call(this, watcher)
    if (mode === 'dev' && extraFiles.length === 0)
      expect(add).not.toHaveBeenCalled()
    return result
  })
  const plugin = UniPages({ dts: true })
  if (mode === 'dev') {
    const server = await createServer({
      root,
      configFile: false,
      plugins: [plugin],
      css: { postcss: {} },
      server: { middlewareMode: true, hmr: false },
      logLevel: 'silent',
    })
    close = () => server.close()
  }
  else {
    const result = await build({
      root,
      configFile: false,
      plugins: [plugin],
      css: { postcss: {} },
      logLevel: 'silent',
      build: { watch: {}, lib: { entry: path.join(root, 'entry.js'), formats: ['es'] }, minify: false },
    })
    if (Array.isArray(result) || !('on' in result))
      throw new Error('Expected a watch build')
    close = () => result.close()
  }
  await readyPromise
  expect(watched).toBeDefined()
  // Vite 5 的缺失 .env 候选会使 chokidar 提前 ready；等待文件实际注册后再写盘。
  // 两边都按真实路径比较：workspace 依赖经由 node_modules 符号链接引入，
  // 而 chokidar 的 getWatched() 报的是链接目标的真实路径
  await vi.waitFor(() => {
    const watchedFiles = Object.entries(watched!.getWatched()).flatMap(([directory, files]) =>
      files.map(file => normalizeConfigPath(path.resolve(directory, file), root)),
    )
    const targets = ['pages.config.ts', 'leaf.ts', 'old-leaf.ts', 'src/pages/index.vue', ...extraFiles].filter(file => fs.existsSync(path.join(root, file)))
    for (const file of targets)
      expect(watchedFiles).toContain(normalizeConfigPath(path.join(root, file), root))
  }, { timeout: 10000 })
  await settleUpdates()
  const save = async (file: string, content: string, stage = 'save'): Promise<void> => {
    const absolute = normalizePath(path.join(root, file))
    let observed = false
    const onEvent = (event: string, filepath: string): void => {
      if ((event === 'add' || event === 'change') && normalizePath(filepath) === absolute)
        observed = true
    }
    watched!.on('all', onEvent)
    try {
      // chokidar 只在 mtimeMs 变化时才发 change，而且对同一路径 50 ms 内的重复 change
      // 直接丢弃。写完把 mtime 推到比原值大，并在被节流时等过窗口再推一次；
      // Date 会把毫秒截成整数，所以推进后的值必须比原值大，不能只加一次
      const previousStat = fs.existsSync(absolute) ? fs.statSync(absolute) : undefined
      let nextMtime = Math.max(Date.now() + 1, (previousStat?.mtimeMs ?? 0) + 1)
      record('write', stage, absolute)
      write(file, content)
      fs.utimesSync(absolute, new Date(nextMtime), new Date(nextMtime))
      const waitForEvent = (): Promise<void> =>
        vi.waitFor(() => expect(observed, `${stage}: watcher event for ${file}`).toBe(true), { timeout: 10000, interval: 10 })
      try {
        await waitForEvent()
      }
      catch (initialFailure) {
        // 上一次 change 还在节流窗口里，等到窗口过去后用更大的 mtime 再触发一次
        await delay(CHANGE_THROTTLE_MS)
        nextMtime = Math.max(Date.now() + 1, fs.statSync(absolute).mtimeMs + 1)
        fs.utimesSync(absolute, new Date(nextMtime), new Date(nextMtime))
        try {
          await waitForEvent()
        }
        catch {
          throw initialFailure
        }
      }
    }
    catch (error) {
      throw new Error(`Config watcher failed: ${diagnose(stage, file)}`, { cause: error })
    }
    finally {
      watched!.off('all', onEvent)
    }
  }
  const remove = async (file: string): Promise<void> => {
    const absolute = normalizePath(path.join(root, file))
    let observed = false
    const onUnlink = (filepath: string): void => {
      if (normalizePath(filepath) === absolute)
        observed = true
    }
    watched!.on('unlink', onUnlink)
    try {
      record('remove', 'unlink', absolute)
      fs.unlinkSync(path.join(root, file))
      // 加载失败可能先于原生删除事件；确认监听器完成删除后才能重建同一路径
      await vi.waitFor(() => expect(observed, `unlink event for ${file}`).toBe(true), { timeout: 10000, interval: 10 })
      await settleUpdates()
    }
    catch (error) {
      throw new Error(`Config watcher failed: ${diagnose('remove', file)}`, { cause: error })
    }
    finally {
      watched!.off('unlink', onUnlink)
    }
  }
  return { watcher: watched!, scheduledUpdates: () => updates.mock.calls.length, registrationCount, settleUpdates, save, remove }
}

describe('真实配置依赖 watcher', () => {
  it.each(['dev', 'build'] as const)('%s 监听根目录外的 workspace 包真实路径', async (mode) => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-workspace-config-')))
    try {
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
      fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"workspace-config","type":"module","exports":"./index.ts"}')
      fs.writeFileSync(path.join(workspace, 'index.ts'), `export { default } from './leaf'`)
      fs.writeFileSync(path.join(workspace, 'leaf.ts'), `export default { title: 'workspace-initial' }`)
      fs.symlinkSync(workspace, path.join(root, 'node_modules/workspace-config'), 'junction')
      write('pages.config.ts', `import config from 'workspace-config'; export default { globalStyle: { navigationBarTitleText: config.title } }`)
      const leaf = path.relative(root, path.join(workspace, 'leaf.ts'))
      const { save } = await start(mode, [leaf])
      await waitTitle('workspace-initial')
      await save(leaf, `export default { title: 'workspace-updated' }`, 'update workspace dependency')
      await waitTitle('workspace-updated')
    }
    finally {
      await close?.()
      close = undefined
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }, 15000)

  it.each(['dev', 'build'] as const)('%s 监听依赖变更、切换依赖及删除恢复，并释放监听', async (mode) => {
    fs.mkdirSync(path.join(root, 'node_modules/unused'), { recursive: true })
    write('node_modules/unused/index.js', 'export default {}')
    write('old-leaf.ts', `export const suffix = ''`)
    write('pages.config.ts', `import { title } from './leaf.ts'; import { suffix } from './old-leaf.ts'; export default { globalStyle: { navigationBarTitleText: title + suffix } }`)
    const { watcher, scheduledUpdates, registrationCount, settleUpdates, save, remove } = await start(mode)
    await waitTitle('initial')
    expect(Object.keys(watcher.getWatched()).some(directory => normalizePath(directory).includes('/node_modules'))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'uni-pages.d.ts'), 'utf8')).toContain('pages/index')
    await save('leaf.ts', `export const title = 'changed'`)
    await waitTitle('changed')
    const registrations = registrationCount()
    await save('next.json', '{"title":"next"}', 'create JSON dependency')
    await save('pages.config.ts', `import value from './next.json'; export default { globalStyle: { navigationBarTitleText: value.title } }`)
    await waitTitle('next')
    await settleUpdates()
    expect(registrationCount()).toBe(registrations)
    let before = 0
    let unusedEventUpdates: number | undefined
    const isUnusedFile = (file: string): boolean => normalizePath(file) === normalizePath(path.join(root, 'old-leaf.ts'))
    const beforeEvent = (file: string): void => {
      if (isUnusedFile(file))
        before = scheduledUpdates()
    }
    const afterEvent = (file: string): void => {
      if (!isUnusedFile(file))
        return
      watcher.off('change', beforeEvent)
      watcher.off('change', afterEvent)
      unusedEventUpdates = scheduledUpdates() - before
    }
    // 只比较当前事件的调度，已排队的初始化或配置生成不会影响断言
    watcher.prependListener('change', beforeEvent)
    watcher.on('change', afterEvent)
    await save('old-leaf.ts', `export const suffix = 'unused'`)
    await vi.waitFor(() => expect(unusedEventUpdates).toBe(0))
    await save('next.json', '{"title":"json-updated"}', 'update JSON dependency')
    await waitTitle('json-updated')

    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Promise<void>((resolve) => {
      const load = PageContext.prototype.loadUserPagesConfig
      vi.spyOn(PageContext.prototype, 'loadUserPagesConfig').mockImplementation(async function (this: PageContext) {
        try {
          await load.call(this)
        }
        catch (error) {
          resolve()
          throw error
        }
      })
    })
    await remove('next.json')
    await failure
    expect(output().globalStyle.navigationBarTitleText).toBe('json-updated')
    await save('next.json', '{"title":"recovered"}', 'restore JSON dependency')
    await waitTitle('recovered')
    logger.mockRestore()

    await remove('pages.config.ts')
    await vi.waitFor(() => expect(output().globalStyle).toBeUndefined())
    await save('pages.config.ts', `export default { globalStyle: { navigationBarTitleText: 'entry-restored' } }`, 'restore config entry')
    await waitTitle('entry-restored')

    await close!()
    close = undefined
    // Chokidar 3 的延迟 stat 失败会在关闭后留下空目录记录，直接验证停止监听的行为
    for (const event of ['add', 'change', 'unlink'])
      expect(watcher.listenerCount(event)).toBe(0)
    const updatesAfterClose = scheduledUpdates()
    const contentAfterClose = fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')
    write('pages.config.ts', `export default { globalStyle: { navigationBarTitleText: 'after-close' } }`)
    await delay(200)
    expect(scheduledUpdates()).toBe(updatesAfterClose)
    expect(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')).toBe(contentAfterClose)
  }, 30000)

  it.each([
    ['./leaf-next', 'leaf-next.tsx'],
    ['./dot.name', 'dot.name.ts'],
    ['./typed.js', 'typed.ts'],
  ])('h5 缺失导入 %s 在创建 %s 后恢复', async (specifier, filename) => {
    const { save } = await start('dev')
    await waitTitle('initial')
    const load = PageContext.prototype.loadUserPagesConfig
    let failed = false
    vi.spyOn(PageContext.prototype, 'loadUserPagesConfig').mockImplementation(async function (this: PageContext) {
      try {
        await load.call(this)
      }
      catch (error) {
        failed = true
        throw error
      }
    })
    await save('pages.config.ts', `import { title } from '${specifier}'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await vi.waitFor(() => expect(failed).toBe(true))
    await save(filename, `export const title = 'resolved'`)
    await waitTitle('resolved')
  }, 15000)

  it('h5 新依赖执行失败后，只修复依赖也能恢复', async () => {
    const { save } = await start('dev')
    await waitTitle('initial')
    const load = PageContext.prototype.loadUserPagesConfig
    let failed = false
    vi.spyOn(PageContext.prototype, 'loadUserPagesConfig').mockImplementation(async function (this: PageContext) {
      try {
        await load.call(this)
      }
      catch (error) {
        failed = true
        throw error
      }
    })
    await save('throws.ts', `throw new Error('runtime failure'); export const title = 'unused'`)
    await save('pages.config.ts', `import { title } from './throws.ts'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await vi.waitFor(() => expect(failed).toBe(true))
    expect(output().globalStyle.navigationBarTitleText).toBe('initial')
    await save('throws.ts', `export const title = 'runtime-fixed'`)
    await waitTitle('runtime-fixed')
  }, 15000)

  it('h5 的语法错误和新增缺失导入修复后继续更新', async () => {
    const { save } = await start('dev')
    await waitTitle('initial')
    const load = PageContext.prototype.loadUserPagesConfig
    let failed = 0
    vi.spyOn(PageContext.prototype, 'loadUserPagesConfig').mockImplementation(async function (this: PageContext) {
      try {
        await load.call(this)
      }
      catch (error) {
        failed++
        throw error
      }
    })
    await save('leaf.ts', 'export const title =')
    await vi.waitFor(() => expect(failed).toBeGreaterThan(0))
    await save('leaf.ts', `export const title = 'syntax-fixed'`)
    await waitTitle('syntax-fixed')
    const previous = failed
    await save('pages.config.ts', `import { title } from './missing/title'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await vi.waitFor(() => expect(failed).toBeGreaterThan(previous))
    fs.mkdirSync(path.join(root, 'missing'))
    await save('missing/title.ts', `export const title = 'created'`)
    await waitTitle('created')
  }, 30000)
})
