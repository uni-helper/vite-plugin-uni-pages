import type { FSWatcher } from 'vite'
import type { UserOptions } from '../packages/core/src/types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'comment-json'
import { build, createServer, normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'
import { configWatchDirectory, isConfigLoaderArtifact, normalizeConfigPath } from '../packages/core/src/config-loader'
import { PageContext } from '../packages/core/src/context'
import { flushPageUpdates } from './helpers/page-watcher'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

let root: string
let close: (() => Promise<unknown>) | undefined
const write = (file: string, content: string): void => fs.writeFileSync(path.join(root, file), content)
const output = (): any => parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8'))
async function waitTitle(title: string): Promise<void> {
  await vi.waitFor(() => expect(output().globalStyle.navigationBarTitleText).toBe(title), { timeout: 20000, interval: 20 })
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

async function start(mode: 'dev' | 'build', extraFiles: string[] = [], userOptions: UserOptions = {}): Promise<WatcherSession> {
  const updates = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  const contexts: PageContext[] = []
  let events = 0
  const settleUpdates = async (): Promise<void> => {
    let snapshot = ''
    let quietSince = Date.now()
    await vi.waitFor(async () => {
      await flushPageUpdates(contexts[0])
      const current = `${events}:${updates.mock.calls.length}`
      if (snapshot !== current) {
        snapshot = current
        quietSince = Date.now()
      }
      expect(Date.now() - quietSince, '配置事件与更新队列应收敛').toBeGreaterThanOrEqual(250)
    }, { timeout: 10000, interval: 50 })
  }
  let watched: FSWatcher | undefined
  let registrationCount = (): number => 0
  const history = new Map<string, object[]>()
  const record = (kind: string, event: string, file: string, watchedPath?: string): void => {
    const key = normalizeConfigPath(file, root)
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
      events: history.get(normalizeConfigPath(absolute, root)) || [],
    })
  }
  let markReady!: () => void
  const readyPromise = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(async function (this: PageContext, watcher) {
    contexts.push(this)
    watched = watcher as unknown as FSWatcher
    const add = vi.spyOn(watched, 'add')
    registrationCount = () => add.mock.calls.length
    watched.on('all', (event, file) => {
      events++
      record('all', event, file)
    })
    watched.on('raw', (event, file, details) => record('raw', event, file, details?.watchedPath))
    watched.once('ready', markReady)
    const result = setup.call(this, watcher)
    if (mode === 'dev' && extraFiles.length === 0)
      expect(add).not.toHaveBeenCalled()
    return result
  })
  const plugin = UniPages({ dts: true, ...userOptions })
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
  const ready = async (file: string): Promise<void> => {
    const absolute = normalizeConfigPath(path.join(root, file), root)
    const directory = configWatchDirectory(absolute)
    await vi.waitFor(() => {
      const entries = Object.entries(watched!.getWatched())
      const files = entries.flatMap(([parent, names]) => names.map(name => normalizeConfigPath(path.join(parent, name), root)))
      if (fs.existsSync(absolute))
        expect(files, `订阅尚未覆盖 ${file}`).toContain(absolute)
      expect(entries.map(([parent]) => normalizeConfigPath(parent, root))).toContain(directory)
    }, { timeout: 10000 })
    const prefix = `.config-watch-ready-${Math.random().toString(36).slice(2)}-`
    const sentinels: string[] = []
    let observed = false
    const onEvent = (_event: string, target: string): void => {
      if (path.basename(target).startsWith(prefix))
        observed = true
    }
    watched!.on('all', onEvent)
    try {
      await vi.waitFor(() => {
        const sentinel = path.join(directory, `${prefix}${sentinels.length}`)
        sentinels.push(sentinel)
        fs.writeFileSync(sentinel, '')
        expect(observed, `原生订阅尚未覆盖 ${directory}`).toBe(true)
      }, { timeout: 10000, interval: 100 })
    }
    finally {
      watched!.off('all', onEvent)
      for (const sentinel of sentinels)
        fs.rmSync(sentinel, { force: true })
    }
    await settleUpdates()
  }
  await ready(extraFiles[0] ?? (fs.existsSync(path.join(root, 'pages.config.ts')) ? 'pages.config.ts' : 'src/pages/index.vue'))
  const save = async (file: string, content: string, stage = 'save'): Promise<void> => {
    const absolute = normalizeConfigPath(path.join(root, file), root)
    let observed = false
    const onEvent = (event: string, filepath: string): void => {
      if ((event === 'add' || event === 'change') && normalizeConfigPath(filepath, root) === absolute)
        observed = true
    }
    try {
      await ready(file)
      watched!.on('all', onEvent)
      record('write', stage, absolute)
      write(file, content)
      await vi.waitFor(() => expect(observed, `${stage}: 原生配置事件 ${file}`).toBe(true), { timeout: 10000, interval: 10 })
      await settleUpdates()
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
    await ready(file)
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
  describe.each(['dev', 'build'] as const)('%s', (mode) => {
    it.each(['pages.config', 'pages.custom', 'pages.config.ts', 'pages.config.json'])('配置入口 %s 修改后更新产物', async (filename) => {
      fs.unlinkSync(path.join(root, 'pages.config.ts'))
      const serialize = (title: string): string => {
        const config = JSON.stringify({ globalStyle: { navigationBarTitleText: title } })
        return filename.endsWith('.ts') ? `export default ${config}` : config
      }
      write(filename, serialize('entry-initial'))
      const options: UserOptions = filename === 'pages.custom'
        ? { configSource: { files: filename, extensions: [], parser: file => JSON.parse(fs.readFileSync(file, 'utf8')) } }
        : {}
      const { save, settleUpdates } = await start(mode, [filename], options)
      expect(output().globalStyle.navigationBarTitleText).toBe('entry-initial')

      await save(filename, serialize('entry-updated'))
      await settleUpdates()
      expect(output().globalStyle.navigationBarTitleText).toBe('entry-updated')
    }, 45000)

    it.each([
      ['settings.bundled_config.ts', 'entry'],
      ['__unconfig_constants.ts', 'entry'],
      ['settings.bundled_config.ts', 'direct'],
      ['__unconfig_constants.ts', 'direct'],
      ['settings.bundled_config.ts', 'nested'],
      ['__unconfig_constants.ts', 'nested'],
    ])('%s 作为 %s 可单次修改、删除恢复，并隔离 transform 产物', async (filename, position) => {
      const entry = position === 'entry' ? filename : 'pages.config.ts'
      const target = position === 'nested' ? `nested/${filename}` : filename
      fs.mkdirSync(path.join(root, 'nested'))
      const code = (title: string): string => `export default { globalStyle: { navigationBarTitleText: '${title}' } }`
      write(target, code('before'))
      if (position === 'direct')
        write(entry, `export { default } from './${target}'`)
      if (position === 'nested') {
        write(entry, `export { default } from './nested/module.ts'`)
        write('nested/module.ts', `export { default } from './${filename}'`)
      }
      const neighbor = `__unconfig_${entry}`
      write(neighbor, 'real-neighbor')
      const { watcher, save, remove, scheduledUpdates, settleUpdates } = await start(mode, [entry, target], {
        configSource: { files: entry, extensions: [], transform: code => `${code}\n// transformed in memory` },
      })
      expect(output().globalStyle.navigationBarTitleText).toBe('before')
      await save(target, code('after'))
      expect(output().globalStyle.navigationBarTitleText).toBe('after')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await remove(target)
      expect(output().globalStyle?.navigationBarTitleText).toBe(position === 'entry' ? undefined : 'after')
      await save(target, code('restored'))
      expect(output().globalStyle.navigationBarTitleText).toBe('restored')
      if (position !== 'entry') {
        await save('next.ts', code('next'))
        await save(entry, `export { default } from './next.ts'`)
        expect(output().globalStyle.navigationBarTitleText).toBe('next')
        const before = scheduledUpdates()
        await save(target, code('obsolete'))
        expect(scheduledUpdates()).toBe(before)
        expect(output().globalStyle.navigationBarTitleText).toBe('next')
      }
      await settleUpdates()
      const subscriptions = Object.entries(watcher.getWatched()).flatMap(([directory, names]) => [directory, ...names.map(name => path.join(directory, name))])
      expect(subscriptions.filter(file => isConfigLoaderArtifact(file, path.join(root, 'node_modules/.cache/uni-pages')))).toEqual([])
      expect(fs.readdirSync(path.join(root, 'node_modules/.cache/uni-pages'))).toEqual([])
      expect(fs.readFileSync(path.join(root, neighbor), 'utf8')).toBe('real-neighbor')
    }, 45000)

    it.each(['missing', 'syntax', 'runtime'])('连续 %s 失败只保留当前恢复路径', async (failure) => {
      const { save, scheduledUpdates } = await start(mode)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const config = (file: string): string => `import { title } from './${file}'; export default { globalStyle: { navigationBarTitleText: title } }`
      for (const file of ['a.ts', 'b.ts']) {
        if (failure !== 'missing')
          await save(file, failure === 'syntax' ? 'export const title =' : `throw new Error('broken'); export const title = 'unused'`)
        await save('pages.config.ts', config(file))
        expect(output().globalStyle.navigationBarTitleText).toBe('initial')
      }
      const before = scheduledUpdates()
      await save('a.ts', `export const title = 'obsolete'`)
      expect(scheduledUpdates()).toBe(before)
      expect(output().globalStyle.navigationBarTitleText).toBe('initial')
      await save('b.ts', `export const title = 'recovered'`)
      expect(output().globalStyle.navigationBarTitleText).toBe('recovered')
    }, 45000)

    it.each(['config/custom.ts', 'config/package.json'])('目录导入在补建 %s 后恢复', async (missingFile) => {
      fs.mkdirSync(path.join(root, 'config'))
      const files: Record<string, string> = {
        'config/package.json': '{"main":"./custom.ts"}',
        'config/custom.ts': `export const title = 'directory-recovered'`,
      }
      const existingFile = missingFile === 'config/custom.ts' ? 'config/package.json' : 'config/custom.ts'
      write(existingFile, files[existingFile])
      const { save, settleUpdates } = await start(mode, [existingFile])
      expect(output().globalStyle.navigationBarTitleText).toBe('initial')
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
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await save('pages.config.ts', `import { title } from './config'; export default { globalStyle: { navigationBarTitleText: title } }`)
      await settleUpdates()
      expect(failed).toBe(true)
      expect(output().globalStyle.navigationBarTitleText).toBe('initial')

      await save(missingFile, files[missingFile])
      await settleUpdates()
      expect(output().globalStyle.navigationBarTitleText).toBe('directory-recovered')
    }, 45000)
  })

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
  }, 45000)

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
    await vi.waitFor(() => expect(unusedEventUpdates).toBe(0), { timeout: 10000 })
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
    await vi.waitFor(() => expect(output().globalStyle).toBeUndefined(), { timeout: 10000 })
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
  }, 45000)

  describe.each(['dev', 'build'] as const)('%s 缺失导入恢复', (mode) => {
    it.each([
      ['./leaf-next', 'leaf-next.tsx'],
      ['./dot.name', 'dot.name.ts'],
      ['./typed.js', 'typed.ts'],
    ])('缺失导入 %s 在创建 %s 后恢复', async (specifier, filename) => {
      const { save } = await start(mode)
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
      await vi.waitFor(() => expect(failed).toBe(true), { timeout: 10000 })
      await save(filename, `export const title = 'resolved'`)
      await waitTitle('resolved')
    }, 45000)
  })

  it.each(['dev', 'build'] as const)('%s 新依赖执行失败后，只修复依赖也能恢复', async (mode) => {
    const { save } = await start(mode)
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
    await vi.waitFor(() => expect(failed).toBe(true), { timeout: 10000 })
    expect(output().globalStyle.navigationBarTitleText).toBe('initial')
    await save('throws.ts', `export const title = 'runtime-fixed'`)
    await waitTitle('runtime-fixed')
  }, 45000)

  it.each(['dev', 'build'] as const)('%s 的语法错误和新增缺失导入修复后继续更新', async (mode) => {
    const { save } = await start(mode)
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
    await vi.waitFor(() => expect(failed).toBeGreaterThan(0), { timeout: 10000 })
    await save('leaf.ts', `export const title = 'syntax-fixed'`)
    await waitTitle('syntax-fixed')
    const previous = failed
    await save('pages.config.ts', `import { title } from './missing/title'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await vi.waitFor(() => expect(failed).toBeGreaterThan(previous), { timeout: 10000 })
    fs.mkdirSync(path.join(root, 'missing'))
    await save('missing/title.ts', `export const title = 'created'`)
    await waitTitle('created')
  }, 45000)
})
