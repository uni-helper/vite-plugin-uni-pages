import type { ChokidarOptions, FSWatcher } from 'chokidar'
import type { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import type { WatchOptions } from 'vite'
import type { PageSource } from './page-sources'
import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import picomatch from 'picomatch'
import { globSync } from 'tinyglobby'
import { normalizePath } from 'vite'
import { isPageDirectoryEvent, isPageFileInDirectories, resolvePageDirs } from './directories'
import { isMissingFsError, isTargetFile } from './files'
import { getPageRules } from './page-rules'
import { createPageWatchFilter } from './page-watch-filter'

interface SourceTarget {
  target: string
  exists: boolean
  links: string[]
  identity?: string
}

interface EntranceWatch {
  watcher: EventEmitter
  close: () => void
  entries: Set<string> | undefined
  identity: string
}

function contains(directory: string, file: string): boolean {
  return file === directory || file.startsWith(`${directory.replace(/\/$/, '')}/`)
}

/** 逐段解析链接，保留可确认的悬空目标 */
function resolveTarget(source: string): SourceTarget {
  let remaining = path.resolve(source)
  const links: string[] = []
  for (let redirects = 0; redirects < 40; redirects++) {
    const root = path.parse(remaining).root
    const parts = remaining.slice(root.length).split(path.sep).filter(Boolean)
    let current = root
    let redirected = false
    let identity: string | undefined
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part)
      try {
        const stat = fs.lstatSync(current)
        identity = `${stat.dev}:${stat.ino}`
        if (stat.isSymbolicLink()) {
          links.push(normalizePath(current))
          remaining = path.resolve(path.dirname(current), fs.readlinkSync(current), ...parts.slice(index + 1))
          redirected = true
          break
        }
      }
      catch (error) {
        if (!isMissingFsError(error))
          throw error
        return { target: normalizePath(path.join(current, ...parts.slice(index + 1))), exists: false, links }
      }
    }
    if (!redirected)
      return { target: normalizePath(current), exists: true, links, identity }
  }
  return { target: normalizePath(remaining), exists: false, links }
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false
  }
  catch (error) {
    if (!isMissingFsError(error))
      throw error
    return false
  }
}

/** 当前词法页面来源、物理内容订阅及非递归入口观察 */
export class PageSourceWatch {
  private rules: ReturnType<typeof getPageRules>
  private directories = new Map<string, SourceTarget>()
  private files = new Map<string, SourceTarget>()
  private contentKey = ''
  private contentRules: ReturnType<typeof getPageRules> | undefined
  private readonly recoveryWatchers = new Map<string, EntranceWatch>()
  private readonly closing = new Set<Promise<void>>()
  private started = false
  private usePolling = false
  private interval = 100
  private ignored: ((file: string, stats?: Stats) => boolean) | undefined
  watcher?: FSWatcher

  constructor(
    private readonly options: ResolvedOptions,
    private readonly onFile: (event: 'add' | 'change' | 'unlink', file: string) => void,
    private readonly onStructure: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.rules = getPageRules(options)
  }

  start(options: Pick<ChokidarOptions, 'usePolling' | 'interval' | 'cwd'> = {}, ignored?: WatchOptions['ignored']): void {
    if (this.started)
      return
    const polling = process.env.CHOKIDAR_USEPOLLING?.toLowerCase()
    this.usePolling = polling === undefined ? !!options.usePolling : !!polling && polling !== 'false' && polling !== '0'
    const interval = process.env.CHOKIDAR_INTERVAL
      ? Number.parseInt(process.env.CHOKIDAR_INTERVAL, 10)
      : options.interval ?? 100
    this.interval = Number.isFinite(interval) && interval > 0 ? interval : 100
    this.ignored = ignored === undefined || (Array.isArray(ignored) && ignored.length === 0)
      ? undefined
      : createPageWatchFilter(ignored, this.options.root, options.cwd)
    this.started = true
    this.refresh()
  }

  private ignoresSource(source: string, stats?: Stats): boolean {
    if (!this.ignored)
      return false
    let current = source
    while (true) {
      let entry = current === source ? stats : undefined
      if (!entry) {
        try {
          entry = fs.statSync(current, { throwIfNoEntry: false })
        }
        catch (error) {
          if (!isMissingFsError(error))
            throw error
        }
      }
      if (this.ignored(current, entry))
        return true
      const parent = normalizePath(path.dirname(current))
      if (parent === current)
        return false
      current = parent
    }
  }

  private createContentWatcher(): FSWatcher {
    const watcher = chokidar.watch([], {
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: this.usePolling,
      interval: this.interval,
      ignored: (file, stats) => {
        const absolute = normalizePath(path.resolve(file))
        if (absolute.split('/').some(part => part === 'node_modules' || part === '.git'))
          return true
        const lock = normalizePath(path.resolve(this.options.root, this.options.outDir, 'pages.json.lock'))
        if (contains(lock, absolute))
          return true
        for (const [source, { target }] of this.directories) {
          if (contains(absolute, target))
            return false
          if (contains(target, absolute)) {
            const lexical = normalizePath(path.join(source, path.relative(target, absolute)))
            if (!this.rules.isExcluded(lexical) && !this.ignoresSource(lexical, stats))
              return false
          }
        }
        return ![...this.files].some(([source, { target }]) => contains(absolute, target) && !this.ignoresSource(source, absolute === target ? stats : undefined))
      },
    })
    for (const event of ['add', 'change', 'unlink'] as const) {
      watcher.on(event, (file) => {
        if (this.started && this.watcher === watcher)
          this.onFile(event, file)
      })
    }
    const onStructure = (): void => {
      if (this.started && this.watcher === watcher)
        this.onStructure()
    }
    watcher.on('addDir', onStructure)
    watcher.on('unlinkDir', onStructure)
    watcher.on('ready', onStructure)
    watcher.on('error', error => this.onError(error))
    return watcher
  }

  /** 来源声明或扫描结果变化后重新解析当前目标 */
  refresh(candidates: readonly PageSource[] = []): void {
    const rules = getPageRules(this.options)
    const currentDirectories = new Set([
      ...this.directories.keys(),
      ...this.options.dirs.map(dir => normalizePath(path.resolve(this.options.root, dir))),
      ...this.options.subPackages.map(dir => normalizePath(path.resolve(this.options.root, dir))),
    ])
    for (const pattern of rules.patterns) {
      const portable = process.platform === 'win32' ? pattern.replace(/\\(?![()[\]{}!+@])/g, '/') : pattern
      if (!picomatch.scan(portable).isGlob) {
        currentDirectories.add(normalizePath(path.resolve(this.options.root, portable.replace(/\\(?=[[\](){}!*+?@|])/g, ''))))
      }
      else if (this.options.mergePages) {
        for (const directory of resolvePageDirs(pattern, this.options.root, this.options.exclude))
          currentDirectories.add(normalizePath(path.resolve(this.options.root, directory)))
      }
    }
    const directories = new Map<string, SourceTarget>()
    for (const source of currentDirectories) {
      if (this.options.mergePages && rules.matchesDirectory(source) && !this.ignoresSource(source))
        directories.set(source, resolveTarget(source))
    }
    const currentFiles = new Set([...this.files.keys(), ...candidates.map(source => source.file)])
    const files = new Map<string, SourceTarget>()
    for (const source of currentFiles) {
      if (!isPageFileInDirectories(source, this.options) || this.ignoresSource(source))
        continue
      const resolved = resolveTarget(source)
      const covered = [...directories].some(([directory, { target }]) => contains(directory, source)
        && normalizePath(path.join(target, path.relative(directory, source))) === resolved.target)
      if (resolved.target !== source && !covered)
        files.set(source, resolved)
    }
    this.rules = rules
    this.directories = directories
    this.files = files
    if (this.started)
      this.reconcile()
  }

  fileForEvent(file: string, identity: string): string | undefined {
    const absolute = normalizePath(path.resolve(this.options.root, file))
    if (isTargetFile(absolute) && isPageFileInDirectories(absolute, this.options) && !this.ignoresSource(absolute))
      return absolute
    for (const [source, { target }] of this.files) {
      if (target === identity && isPageFileInDirectories(source, this.options) && !this.ignoresSource(source) && resolveTarget(source).target === target)
        return source
    }
    for (const [source, { target }] of this.directories) {
      if (!contains(target, identity) || resolveTarget(source).target !== target)
        continue
      const lexical = normalizePath(path.join(source, path.relative(target, identity)))
      if (isTargetFile(lexical) && isPageFileInDirectories(lexical, this.options) && !this.ignoresSource(lexical))
        return lexical
    }
  }

  directoryForEvent(directory: string): boolean {
    if (!this.options.mergePages)
      return false
    const absolute = normalizePath(path.resolve(this.options.root, directory))
    if (!this.ignoresSource(absolute) && (getPageRules(this.options).matchesDirectory(absolute) || [...this.directories.keys()].some(source => contains(absolute, source))))
      return true
    return this.options.mergePages && [...this.directories, ...this.files].some(([source, { target }]) =>
      contains(absolute, target)
      && (isPageDirectoryEvent(source, this.options) || isPageFileInDirectories(source, this.options))
      && !this.ignoresSource(source)
      && resolveTarget(source).target === target,
    )
  }

  async close(): Promise<void> {
    this.started = false
    for (const { close } of this.recoveryWatchers.values())
      close()
    this.recoveryWatchers.clear()
    this.contentKey = ''
    this.contentRules = undefined
    const watcher = this.watcher
    this.watcher = undefined
    await Promise.all([watcher?.close(), ...this.closing])
  }

  private reconcile(): void {
    const resolved = [...this.directories.values(), ...this.files.values()].filter(source => source.exists)
    const directories = [...this.directories.values()].filter(source => source.exists).map(source => source.target)
    const wanted = new Map(resolved.filter(({ target }) => !directories.some(directory => directory !== target && contains(directory, target)))
      .map(({ target, identity }) => [target, identity]))
    const key = JSON.stringify([...wanted].sort(([a], [b]) => a.localeCompare(b)))
    if (key !== this.contentKey || this.contentRules !== this.rules) {
      if (this.watcher) {
        // chokidar.unwatch 不会释放目录后代的全部句柄；重建自有订阅才能收回旧目标
        const closing = this.watcher.close()
        this.closing.add(closing)
        void closing.then(
          () => this.closing.delete(closing),
          (error) => {
            this.closing.delete(closing)
            this.onError(error)
          },
        )
        this.watcher = undefined
      }
      if (wanted.size) {
        this.watcher = this.createContentWatcher()
        this.watcher.add([...wanted.keys()])
      }
      this.contentKey = key
      this.contentRules = this.rules
    }
    this.refreshEntrances()
  }

  private refreshFromEntrance(): void {
    const signature = (): string => JSON.stringify([...this.directories, ...this.files]
      .map(([source, { target, exists, identity }]) => [source, target, exists, identity])
      .sort(([a], [b]) => String(a).localeCompare(String(b))))
    try {
      const previous = signature()
      this.refresh()
      if (signature() !== previous)
        this.onStructure()
    }
    catch (error) {
      this.onError(error)
    }
  }

  private refreshEntrances(): void {
    const wanted = new Map<string, Set<string> | undefined>()
    const observe = (directory: string, entry?: string): void => {
      const normalized = normalizePath(directory)
      if (!entry) {
        wanted.set(normalized, undefined)
        return
      }
      if (wanted.has(normalized) && !wanted.get(normalized))
        return
      const entries = wanted.get(normalized) ?? new Set<string>()
      entries.add(entry)
      wanted.set(normalized, entries)
    }
    const entrance = (file: string): void => {
      let child = file
      let directory = path.dirname(child)
      while (!isDirectory(directory)) {
        child = directory
        const parent = path.dirname(directory)
        if (parent === directory)
          return
        directory = parent
      }
      observe(directory, path.basename(child))
    }
    for (const [source, resolved] of [...this.directories, ...this.files]) {
      entrance(source)
      entrance(resolved.target)
      for (const link of resolved.links)
        entrance(link)
    }
    if (this.options.mergePages) {
      const rules = getPageRules(this.options)
      for (const pattern of rules.patterns) {
        const portable = process.platform === 'win32' ? pattern.replace(/\\(?![()[\]{}!+@])/g, '/') : pattern
        const normalized = path.posix.normalize(portable)
        const scan = picomatch.scan(normalized, { parts: true })
        if (!scan.isGlob)
          continue
        const base = normalizePath(path.resolve(this.options.root, (scan.base || '.').replace(/\\(?=[[\](){}!*+?@|])/g, '')))
        if (rules.isExcluded(base) || this.ignoresSource(base))
          continue
        entrance(base)
        if (isDirectory(base))
          observe(base)
        const parts = scan.parts ?? []
        for (let length = 1; length < parts.length; length++) {
          const prefix = parts.slice(0, length).join('/') || '/'
          if (!picomatch.scan(prefix).isGlob)
            continue
          const directories = globSync(prefix, { cwd: this.options.root, onlyDirectories: true, expandDirectories: false, dot: true, ignore: rules.traversalIgnores })
          for (const directory of directories) {
            const absolute = normalizePath(path.resolve(this.options.root, directory))
            if (!rules.isExcluded(absolute) && !this.ignoresSource(absolute)) {
              entrance(absolute)
              observe(absolute)
            }
          }
        }
      }
    }
    for (const [directory, entry] of this.recoveryWatchers) {
      if (!wanted.has(directory)) {
        entry.close()
        this.recoveryWatchers.delete(directory)
      }
    }
    for (const [directory, entries] of wanted) {
      try {
        const stat = fs.statSync(directory)
        const identity = `${stat.dev}:${stat.ino}`
        const existing = this.recoveryWatchers.get(directory)
        if (existing?.identity === identity) {
          existing.entries = entries
          continue
        }
        existing?.close()
        let entry: EntranceWatch
        let watcher: EventEmitter
        let stop: () => void
        if (this.usePolling) {
          const onChange = (): void => {
            if (this.recoveryWatchers.get(directory) === entry)
              this.refreshFromEntrance()
          }
          watcher = fs.watchFile(directory, { persistent: false, interval: this.interval }, onChange)
          stop = () => fs.unwatchFile(directory, onChange)
        }
        else {
          const nativeWatcher = fs.watch(directory, { recursive: false, persistent: false }, (event, filename) => {
            const observed = this.recoveryWatchers.get(directory)
            if (observed !== entry || event !== 'rename')
              return
            const name = filename?.toString()
            if (!name || !observed.entries || observed.entries.has(name) || name === path.basename(directory))
              this.refreshFromEntrance()
          })
          watcher = nativeWatcher
          stop = () => nativeWatcher.close()
        }
        const onError = (error: unknown): void => {
          if (this.recoveryWatchers.get(directory) !== entry)
            return
          entry.close()
          this.recoveryWatchers.delete(directory)
          if (!isMissingFsError(error))
            this.onError(error)
          if (this.started)
            this.refreshFromEntrance()
        }
        watcher.on('error', onError)
        entry = {
          watcher,
          entries,
          identity,
          close: () => {
            watcher.off('error', onError)
            stop()
          },
        }
        this.recoveryWatchers.set(directory, entry)
      }
      catch (error) {
        if (!isMissingFsError(error))
          this.onError(error)
      }
    }
  }
}
