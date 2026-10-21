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

const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { default: chokidar } = await import(require.resolve('chokidar'))

const roots: string[] = []
const watchers: PageSourceWatch[] = []

function fixture(polling = 'false') {
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
    sourceWatch.refresh([])
  }
  refresh()
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
    expect(watch.mock.calls.every(call => (call as unknown as [string, { recursive: boolean }])[1].recursive === false)).toBe(true)
    expect(content.add.mock.calls.flat(2)).not.toContain(normalizePath(workspace))
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
    expect(onStructure).toHaveBeenCalledOnce()
    expect(unwatchFile).toHaveBeenCalledWith(parent, ownListener)
    expect(observer.listeners('change')).toEqual([otherListener])
    expect(pollingEntrances.has(normalizePath(workspace))).toBe(true)

    fs.mkdirSync(target, { recursive: true })
    pollingEntrances.get(normalizePath(workspace))!.emit('change', fs.statSync(workspace), fs.statSync(workspace))
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
})
