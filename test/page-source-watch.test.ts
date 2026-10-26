import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshPageDirectories } from '../packages/core/src/directories'
import { resolveOptions } from '../packages/core/src/options'
import { PageSourceWatch } from '../packages/core/src/page-watch'
import { createScanPlan } from '../packages/core/src/scan-plan'

const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { default: chokidar } = await import(require.resolve('chokidar'))

const roots: string[] = []
const watchers: PageSourceWatch[] = []

function fixture(polling = 'false', autoStart = true) {
  vi.stubEnv('CHOKIDAR_USEPOLLING', polling)
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-source-watch-')))
  roots.push(workspace)
  const root = path.join(workspace, 'app')
  const target = path.join(workspace, 'shared/pages')
  const alias = path.join(root, 'src/alias')
  fs.mkdirSync(path.dirname(alias), { recursive: true })
  fs.mkdirSync(target, { recursive: true })
  fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const content = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn(async () => {}), close: vi.fn(async () => {}) })
  vi.spyOn(chokidar, 'watch').mockReturnValue(content)
  const entrances = new Map<string, ReturnType<typeof fs.watch>>()
  const watch = vi.spyOn(fs, 'watch').mockImplementation(((file: string, _options: unknown, listener: (...args: any[]) => void) => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn() })
    watcher.on('change', listener)
    entrances.set(normalizePath(file), watcher as unknown as ReturnType<typeof fs.watch>)
    return watcher
  }) as unknown as typeof fs.watch)
  const pollingEntrances = new Map<string, EventEmitter>()
  const watchFile = vi.spyOn(fs, 'watchFile').mockImplementation(((file: string, _options: unknown, listener: (...args: any[]) => void) => {
    const watcher = pollingEntrances.get(normalizePath(file)) ?? new EventEmitter()
    watcher.on('change', listener)
    pollingEntrances.set(normalizePath(file), watcher)
    return watcher
  }) as unknown as typeof fs.watchFile)
  const unwatchFile = vi.spyOn(fs, 'unwatchFile').mockImplementation((file, listener) => {
    if (listener)
      pollingEntrances.get(normalizePath(String(file)))?.off('change', listener)
  })
  const options = resolveOptions({ dir: 'src/alias', dts: false }, root)
  const onStructure = vi.fn()
  const sourceWatch = new PageSourceWatch(options, vi.fn(), onStructure, (error) => {
    throw error
  })
  watchers.push(sourceWatch)
  const refresh = () => {
    refreshPageDirectories(options)
    sourceWatch.refresh(createScanPlan(options))
  }
  refresh()
  if (autoStart)
    sourceWatch.start()
  return { workspace, root, target, alias, content, entrances, watch, watchFile, unwatchFile, pollingEntrances, options, onStructure, sourceWatch, refresh }
}

afterEach(async () => {
  for (const watcher of watchers.splice(0))
    await watcher.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('当前页面来源的监听范围', () => {
  it('目标存在时只递归监听目标，目录入口采用非递归观察', () => {
    const { workspace, target, content, watch } = fixture()
    expect(content.add.mock.calls.flat(2)).toEqual([normalizePath(target)])
    expect(vi.mocked(chokidar.watch).mock.calls[0]?.[1]).toMatchObject({ followSymlinks: false })
    expect(watch.mock.calls.every(call => (call as unknown as [string, { recursive: boolean }])[1].recursive === false)).toBe(true)
    expect(content.add.mock.calls.flat(2)).not.toContain(normalizePath(workspace))
  })

  it('超出安全整数范围的目录身份变化仍重建内容订阅和恢复入口', () => {
    const { target, content, entrances, refresh } = fixture()
    const parent = normalizePath(path.dirname(target))
    const previous = 9007199254740992n
    let inode = previous
    const lstat = fs.lstatSync
    const stat = fs.statSync
    vi.spyOn(fs, 'lstatSync').mockImplementation(((file: fs.PathLike, options?: { bigint?: boolean }) => {
      const result = Reflect.apply(lstat, fs, [file, options]) as fs.Stats | fs.BigIntStats
      if (normalizePath(String(file)) === normalizePath(target))
        result.ino = options?.bigint ? inode : Number(inode)
      return result
    }) as typeof fs.lstatSync)
    vi.spyOn(fs, 'statSync').mockImplementation(((file: fs.PathLike, options?: { bigint?: boolean }) => {
      const result = Reflect.apply(stat, fs, [file, options]) as fs.Stats | fs.BigIntStats
      if (normalizePath(String(file)) === parent)
        result.ino = options?.bigint ? inode : Number(inode)
      return result
    }) as typeof fs.statSync)
    refresh()
    const entrance = entrances.get(parent)!
    content.close.mockClear()
    content.add.mockClear()

    inode = previous + 1n
    expect(Number(inode)).toBe(Number(previous))
    entrance.emit('change', 'rename', path.basename(target))

    expect(content.close).toHaveBeenCalledOnce()
    expect(content.add).toHaveBeenCalledExactlyOnceWith([normalizePath(target)])
    expect(entrance.close).toHaveBeenCalledOnce()
    expect(entrances.get(parent)).not.toBe(entrance)
  })

  it.each(['EACCES', 'EPERM'])('嵌套目录读取遇到 %s 时继续发现其他有效来源', (code) => {
    const { root, target, alias, options, content, sourceWatch, refresh } = fixture()
    options.dir = 'src'
    const denied = path.join(root, 'src/denied')
    fs.mkdirSync(denied)
    const read = fs.readdirSync
    vi.spyOn(fs, 'readdirSync').mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (normalizePath(String(file)) === normalizePath(denied))
        throw Object.assign(new Error('Permission denied'), { code })
      return Reflect.apply(read, fs, [file, options])
    }) as typeof fs.readdirSync)

    expect(refresh).not.toThrow()
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(target)])
    const file = normalizePath(path.join(target, 'index.vue'))
    expect(sourceWatch.fileForEvent(file, file)).toBe(normalizePath(path.join(alias, 'index.vue')))
  })

  it('嵌套目录读取遇到未知文件系统错误时仍抛出', () => {
    const { options, target, sourceWatch } = fixture()
    const read = fs.readdirSync
    const error = Object.assign(new Error('I/O error'), { code: 'EIO' })
    vi.spyOn(fs, 'readdirSync').mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (normalizePath(String(file)) === normalizePath(target))
        throw error
      return Reflect.apply(read, fs, [file, options])
    }) as typeof fs.readdirSync)

    expect(() => sourceWatch.refresh(createScanPlan(options))).toThrow(error)
  })

  it.skipIf(process.platform === 'win32')('链接目标不可读时跳过来源，start 不中断，恢复后可重新发现', () => {
    const { options, target, content, sourceWatch } = fixture('false', false)
    const locked = path.dirname(target)
    fs.chmodSync(locked, 0o000)
    try {
      expect(() => sourceWatch.start({}, ['**/node_modules/**'])).not.toThrow()
      expect((sourceWatch as unknown as { started: boolean }).started).toBe(true)
      expect(content.add).not.toHaveBeenCalled()
    }
    finally {
      fs.chmodSync(locked, 0o755)
    }

    sourceWatch.refresh(createScanPlan(options))
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(target)])
  })

  it('来源发现失败时回滚 start 并允许后续重试', () => {
    const { target, content, sourceWatch } = fixture('false', false)
    const read = fs.readdirSync
    const error = Object.assign(new Error('I/O error'), { code: 'EIO' })
    vi.spyOn(fs, 'readdirSync').mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (normalizePath(String(file)) === normalizePath(target))
        throw error
      return Reflect.apply(read, fs, [file, options])
    }) as typeof fs.readdirSync)

    expect(() => sourceWatch.start()).toThrow(error)
    expect((sourceWatch as unknown as { started: boolean }).started).toBe(false)

    vi.mocked(fs.readdirSync).mockRestore()
    expect(() => sourceWatch.start()).not.toThrow()
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(target)])
  })

  it('缺失目标保留来源关联，恢复后关闭临时祖先观察', () => {
    const { workspace, target, alias, content, entrances, sourceWatch, refresh } = fixture()
    fs.rmSync(path.dirname(target), { recursive: true })
    refresh()
    expect(content.close).toHaveBeenCalledOnce()
    expect(sourceWatch.fileForEvent(path.join(target, 'index.vue'), normalizePath(path.join(target, 'index.vue')))).toBe(normalizePath(path.join(alias, 'index.vue')))
    const ancestor = entrances.get(normalizePath(workspace))!
    expect(ancestor).toBeDefined()
    content.add.mockClear()

    fs.mkdirSync(target, { recursive: true })
    refresh()

    expect(content.add).toHaveBeenCalledWith([normalizePath(target)])
    expect(ancestor.close).toHaveBeenCalledOnce()
  })

  it('链接改指悬空目标后立即淘汰旧目标事件及订阅', () => {
    const { workspace, target, alias, content, sourceWatch, refresh } = fixture()
    const replacement = path.join(workspace, 'replacement/pages')
    fs.unlinkSync(alias)
    fs.symlinkSync(replacement, alias, process.platform === 'win32' ? 'junction' : 'dir')
    // 入口刷新前也不能把旧目标当作当前页面来源
    expect(sourceWatch.fileForEvent(path.join(target, 'index.vue'), normalizePath(path.join(target, 'index.vue')))).toBeUndefined()
    refresh()
    expect(content.close).toHaveBeenCalledOnce()
    expect(sourceWatch.fileForEvent(path.join(replacement, 'index.vue'), normalizePath(path.join(replacement, 'index.vue')))).toBe(normalizePath(path.join(alias, 'index.vue')))
    content.add.mockClear()

    fs.mkdirSync(replacement, { recursive: true })
    refresh()

    expect(content.add).toHaveBeenCalledWith([normalizePath(replacement)])
    expect(sourceWatch.fileForEvent(path.join(target, 'index.vue'), normalizePath(path.join(target, 'index.vue')))).toBeUndefined()
  })

  it('链接入口删除重建后重新解析，旧目标不再有效', () => {
    const { workspace, target, alias, sourceWatch, refresh } = fixture()
    fs.unlinkSync(alias)
    refresh()
    expect(sourceWatch.fileForEvent(path.join(target, 'index.vue'), normalizePath(path.join(target, 'index.vue')))).toBeUndefined()
    const replacement = path.join(workspace, 'replacement')
    fs.mkdirSync(replacement)
    fs.symlinkSync(replacement, alias, process.platform === 'win32' ? 'junction' : 'dir')
    refresh()
    expect(sourceWatch.fileForEvent(path.join(replacement, 'index.vue'), normalizePath(path.join(replacement, 'index.vue')))).toBe(normalizePath(path.join(alias, 'index.vue')))
  })

  it('移除来源声明后释放该来源的内容与入口订阅', () => {
    const { target, alias, options, content, entrances, sourceWatch, refresh } = fixture()
    const sourceEntrance = entrances.get(normalizePath(path.dirname(alias)))!
    options.dir = ''
    refresh()
    expect(content.close).toHaveBeenCalledOnce()
    expect(sourceEntrance.close).toHaveBeenCalledOnce()
    expect(sourceWatch.fileForEvent(path.join(target, 'index.vue'), normalizePath(path.join(target, 'index.vue')))).toBeUndefined()
  })

  it('缺失 glob 路径只推进入口观察，出现有效来源后才通知生成', () => {
    const { workspace, content, entrances, options, onStructure, refresh } = fixture()
    options.dir = '../packages/*/pages'
    options.exclude = ['../packages/hidden']
    refresh()
    content.add.mockClear()
    const packages = path.join(workspace, 'packages')
    fs.mkdirSync(path.join(packages, 'hidden/pages'), { recursive: true })
    entrances.get(normalizePath(workspace))!.emit('change', 'rename', 'packages')

    expect(onStructure).not.toHaveBeenCalled()
    expect(content.add).not.toHaveBeenCalled()
    expect(entrances.has(normalizePath(packages))).toBe(true)

    const available = path.join(packages, 'account/pages')
    fs.mkdirSync(available, { recursive: true })
    entrances.get(normalizePath(packages))!.emit('change', 'rename', 'account')

    expect(onStructure).toHaveBeenCalledOnce()
    expect(content.add).toHaveBeenCalledWith([normalizePath(available)])
  })

  it.each(['true', '1'])('polling=%s 时使用目录状态观察并只撤销自身订阅', async (polling) => {
    vi.stubEnv('CHOKIDAR_INTERVAL', '37')
    const { workspace, target, watch, watchFile, unwatchFile, pollingEntrances, onStructure, sourceWatch } = fixture(polling)
    expect(watch).not.toHaveBeenCalled()
    expect(watchFile).toHaveBeenCalled()
    expect(watchFile.mock.calls.every(call => (call as unknown as [string, { interval: number }])[1].interval === 37)).toBe(true)
    const parent = normalizePath(path.dirname(target))
    const observer = pollingEntrances.get(parent)!
    const ownListener = observer.listeners('change')[0]
    const otherListener = vi.fn()
    observer.on('change', otherListener)

    fs.rmSync(path.dirname(target), { recursive: true })
    observer.emit('change', fs.statSync(workspace), fs.statSync(workspace))
    await Promise.resolve()
    expect(onStructure).toHaveBeenCalledOnce()
    expect(unwatchFile).toHaveBeenCalledWith(parent, ownListener)
    expect(observer.listeners('change')).toEqual([otherListener])
    expect(pollingEntrances.has(normalizePath(workspace))).toBe(true)

    fs.mkdirSync(target, { recursive: true })
    pollingEntrances.get(normalizePath(workspace))!.emit('change', fs.statSync(workspace), fs.statSync(workspace))
    await Promise.resolve()
    expect(onStructure).toHaveBeenCalledTimes(2)
    expect(watch).not.toHaveBeenCalled()

    await sourceWatch.close()
    expect(unwatchFile.mock.calls.every(([, listener]) => typeof listener === 'function')).toBe(true)
    expect(observer.listeners('change')).toEqual([otherListener])
    const before = otherListener.mock.calls.length
    observer.emit('change', fs.statSync(workspace), fs.statSync(workspace))
    expect(otherListener).toHaveBeenCalledTimes(before + 1)
    expect(onStructure).toHaveBeenCalledTimes(2)
  })

  it('polling 未配置间隔时每 100ms 观察目录状态', () => {
    vi.stubEnv('CHOKIDAR_INTERVAL', undefined)
    const { watchFile } = fixture('true')
    expect(watchFile.mock.calls.every(call => (call as unknown as [string, { interval: number }])[1].interval === 100)).toBe(true)
  })

  it('关闭后刷新来源也不会重新建立订阅', async () => {
    const { sourceWatch, refresh, content, watch } = fixture()
    await sourceWatch.close()
    content.add.mockClear()
    watch.mockClear()
    refresh()
    expect(content.add).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
  })

  it('嵌套悬空链接没有页面候选时仍观察目标恢复', () => {
    const { workspace, root, target, options, content, entrances, onStructure, refresh } = fixture()
    options.dir = 'src'
    fs.rmSync(path.dirname(target), { recursive: true })
    refresh()
    const ancestor = entrances.get(normalizePath(workspace))!
    expect(ancestor).toBeDefined()
    content.add.mockClear()

    fs.mkdirSync(target, { recursive: true })
    ancestor.emit('change', 'rename', 'shared')

    expect(onStructure).toHaveBeenCalledOnce()
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(target)])
    expect(ancestor.close).toHaveBeenCalledOnce()
  })

  it('交叉别名共用目标，移除一个入口后保留另一个入口的订阅', () => {
    const { root, target, alias, options, content, sourceWatch, refresh } = fixture()
    const second = path.join(root, 'src/second')
    fs.symlinkSync(target, second, process.platform === 'win32' ? 'junction' : 'dir')
    options.dir = 'src'
    refresh()
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(target)])

    fs.unlinkSync(alias)
    refresh()

    const file = normalizePath(path.join(target, 'index.vue'))
    expect(sourceWatch.fileForEvent(file, file)).toBe(normalizePath(path.join(second, 'index.vue')))
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(target)])
  })

  it('嵌套链接逐层展开，循环不扩张订阅且独立别名继续有效', () => {
    const { workspace, root, target, options, content, sourceWatch, refresh } = fixture()
    const nested = path.join(workspace, 'nested')
    fs.mkdirSync(nested)
    fs.symlinkSync(nested, path.join(target, 'nested'), process.platform === 'win32' ? 'junction' : 'dir')
    fs.symlinkSync(target, path.join(nested, 'back'), process.platform === 'win32' ? 'junction' : 'dir')
    fs.symlinkSync(nested, path.join(root, 'src/second'), process.platform === 'win32' ? 'junction' : 'dir')
    options.dir = 'src'
    refresh()

    expect(content.add.mock.lastCall?.[0].slice().sort()).toEqual([path.join(root, 'src'), target, nested].map(normalizePath).sort())
    const file = normalizePath(path.join(nested, 'index.vue'))
    expect(sourceWatch.fileForEvent(file, file)).toBe(normalizePath(path.join(root, 'src/alias/nested/index.vue')))
  })

  it('重叠物理目标取消父级来源后仍保留子级来源', () => {
    const { root, target, alias, options, content, sourceWatch, refresh } = fixture()
    const child = path.join(target, 'child')
    fs.mkdirSync(child)
    const second = path.join(root, 'src/second')
    fs.symlinkSync(child, second, process.platform === 'win32' ? 'junction' : 'dir')
    options.dir = 'src'
    refresh()
    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(target)])

    fs.unlinkSync(alias)
    refresh()

    expect(content.add).toHaveBeenLastCalledWith([normalizePath(path.join(root, 'src')), normalizePath(child)])
    const file = normalizePath(path.join(child, 'index.vue'))
    expect(sourceWatch.fileForEvent(file, file)).toBe(normalizePath(path.join(second, 'index.vue')))
    const old = normalizePath(path.join(target, 'old.vue'))
    expect(sourceWatch.fileForEvent(old, old)).toBeUndefined()
  })

  it('共享目标分别应用词法排除，移除允许入口后重新收窄过滤', () => {
    const { root, target, options, content, refresh } = fixture()
    const second = path.join(root, 'src/second')
    fs.symlinkSync(target, second, process.platform === 'win32' ? 'junction' : 'dir')
    options.dir = 'src'
    options.exclude = ['src/alias/private']
    refresh()
    const ignored = () => vi.mocked(chokidar.watch).mock.lastCall![1]!.ignored as (file: string) => boolean
    const file = path.join(target, 'private/index.vue')
    expect(ignored()(file)).toBe(false)
    content.close.mockClear()

    fs.unlinkSync(second)
    refresh()

    expect(content.close).toHaveBeenCalledOnce()
    expect(ignored()(file)).toBe(true)
  })

  it('被排除的嵌套链接不展开目标也不建立恢复入口', () => {
    const { workspace, root, target, options, content, entrances, refresh } = fixture()
    options.dir = 'src'
    options.exclude = ['src/alias']
    refresh()
    content.add.mockClear()
    fs.rmSync(path.dirname(target), { recursive: true })
    refresh()

    expect(content.add).not.toHaveBeenCalled()
    expect(entrances.has(normalizePath(workspace))).toBe(false)
    expect(vi.mocked(chokidar.watch).mock.lastCall![1]!.followSymlinks).toBe(false)
    expect(content.add.mock.calls.flat(2)).not.toContain(normalizePath(path.join(root, 'src/alias')))
  })

  it('直接自环保留链接入口，改指有效目标后可以恢复', () => {
    const { workspace, root, options, content, entrances, sourceWatch, refresh } = fixture()
    const loop = path.join(root, 'src/loop')
    const target = path.join(workspace, 'replacement')
    fs.symlinkSync(loop, loop, process.platform === 'win32' ? 'junction' : 'dir')
    options.dir = 'src'
    refresh()
    content.add.mockClear()
    fs.mkdirSync(target)
    fs.unlinkSync(loop)
    fs.symlinkSync(target, loop, process.platform === 'win32' ? 'junction' : 'dir')
    entrances.get(normalizePath(path.dirname(loop)))!.emit('change', 'rename', 'loop')

    expect(content.add.mock.lastCall?.[0]).toContain(normalizePath(target))
    const file = normalizePath(path.join(target, 'index.vue'))
    expect(sourceWatch.fileForEvent(file, file)).toBe(normalizePath(path.join(loop, 'index.vue')))
  })

  it('原生目录通知没有文件名时仍发现新增的悬空链接', async () => {
    const { workspace, root, options, content, entrances, refresh } = fixture()
    options.dir = 'src'
    refresh()
    const target = path.join(workspace, 'later/pages')
    fs.symlinkSync(target, path.join(root, 'src/later'), process.platform === 'win32' ? 'junction' : 'dir')

    content.emit('raw', 'rename', null, { watchedPath: path.join(root, 'src') })
    await Promise.resolve()
    const entrance = entrances.get(normalizePath(workspace))!
    expect(entrance).toBeDefined()
    fs.mkdirSync(target, { recursive: true })
    entrance.emit('change', 'rename', 'later')

    expect(content.add.mock.lastCall?.[0]).toContain(normalizePath(target))
  })
})
