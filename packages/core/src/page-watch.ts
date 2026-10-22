import type { ChokidarOptions, FSWatcher } from 'chokidar'
import type { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import type { WatchOptions } from 'vite'
import type { SourceTarget } from './page-watch-sources'
import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import picomatch from 'picomatch'
import { globSync } from 'tinyglobby'
import { normalizePath } from 'vite'
import { isPageDirectoryEvent, isPageFileInDirectories, normalizePagePattern, resolvePageDirs, unescapePagePattern } from './directories'
import { isMissingFsError, isTargetFile } from './files'
import { getPageRules } from './page-rules'
import { createPageWatchFilter } from './page-watch-filter'
import { collectPageWatchSources, resolveWatchTarget } from './page-watch-sources'

interface EntranceWatch {
  watcher: EventEmitter
  close: () => void
  entries: Set<string> | undefined
  identity: string
}

function contains(directory: string, file: string): boolean {
  return file === directory || file.startsWith(`${directory.replace(/\/$/, '')}/`)
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false
  }
  catch (error) {
    if (!isMissingFsError(error) && (error as NodeJS.ErrnoException).code !== 'ELOOP')
      throw error
    return false
  }
}

/** 当前词法页面来源、物理内容订阅及非递归入口观察 */
export class PageSourceWatch {
  private rules: ReturnType<typeof getPageRules>
  private roots = new Set<string>()
  private links = new Set<string>()
  private directories = new Map<string, SourceTarget>()
  private files = new Map<string, SourceTarget>()
  private contentKey = ''
  private contentRules: ReturnType<typeof getPageRules> | undefined
  private readonly recoveryWatchers = new Map<string, EntranceWatch>()
  private readonly closing = new Set<Promise<void>>()
  private sourceRefreshQueued = false
  private started = false
  private usePolling = false
  private interval = 100
  private awaitWriteFinish: ChokidarOptions['awaitWriteFinish']
  private atomic: ChokidarOptions['atomic']
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

  start(options: Pick<ChokidarOptions, 'usePolling' | 'interval' | 'cwd' | 'awaitWriteFinish' | 'atomic'> = {}, ignored?: WatchOptions['ignored']): void {
    if (this.started)
      return
    const polling = process.env.CHOKIDAR_USEPOLLING?.toLowerCase()
    this.usePolling = polling === undefined ? !!options.usePolling : !!polling && polling !== 'false' && polling !== '0'
    const interval = process.env.CHOKIDAR_INTERVAL
      ? Number.parseInt(process.env.CHOKIDAR_INTERVAL, 10)
      : options.interval ?? 100
    this.interval = Number.isFinite(interval) && interval > 0 ? interval : 100
    this.awaitWriteFinish = options.awaitWriteFinish
    this.atomic = options.atomic
    // 与 chokidar 一致：没有 watcher cwd 时，相对 ignored 规则按 process.cwd() 解析
    this.ignored = ignored === undefined || (Array.isArray(ignored) && ignored.length === 0)
      ? undefined
      : createPageWatchFilter(ignored, this.options.root, options.cwd ?? process.cwd())
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
          if (!isMissingFsError(error) && (error as NodeJS.ErrnoException).code !== 'ELOOP')
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
      // 链接统一解析成物理目标后订阅，避免改指时复用仍绑定旧目标的词法路径句柄
      followSymlinks: false,
      usePolling: this.usePolling,
      interval: this.interval,
      ...(this.awaitWriteFinish !== undefined && { awaitWriteFinish: this.awaitWriteFinish }),
      ...(this.atomic !== undefined && { atomic: this.atomic }),
      ignored: (file, stats) => {
        const absolute = normalizePath(path.resolve(file))
        // node_modules/.git 不在这里硬编码：合法来源可能通过 exclude: [] 链接进依赖，
        // 是否忽略应由 exclude 与 Vite ignored 按词法来源决定
        const lock = normalizePath(path.resolve(this.options.root, this.options.outDir, 'pages.json.lock'))
        if (contains(lock, absolute))
          return true
        for (const [source, { target }] of this.files) {
          if (contains(absolute, target) && !this.rules.isExcluded(source) && !this.ignoresSource(source))
            return false
        }
        for (const [source, { target }] of this.directories) {
          if (contains(absolute, target))
            return false
          if (contains(target, absolute)) {
            const lexical = normalizePath(path.join(source, path.relative(target, absolute)))
            if (!this.rules.isExcluded(lexical) && !this.ignoresSource(lexical, stats))
              return false
          }
        }
        return true
      },
    })
    for (const event of ['add', 'change', 'unlink'] as const) {
      watcher.on(event, (file) => {
        if (!this.started || this.watcher !== watcher)
          return
        if (this.links.has(normalizePath(path.resolve(file))))
          this.queueSourceRefresh()
        else
          this.onFile(event, file)
      })
    }
    // 悬空链接不会产生 chokidar 的 add；原生目录通知用于补充链接发现
    watcher.on('raw', (event, file, raw) => {
      if (!this.started || this.watcher !== watcher)
        return
      const details = (raw ?? {}) as { watchedPath?: string, curr?: Stats }
      if (details.curr?.isDirectory()) {
        this.queueSourceRefresh()
      }
      else if (event === 'rename' && details.watchedPath) {
        if (!file) {
          this.queueSourceRefresh()
          return
        }
        const entry = normalizePath(path.resolve(details.watchedPath, file))
        try {
          if (this.links.has(entry) || fs.lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink())
            this.queueSourceRefresh()
        }
        catch (error) {
          if (!isMissingFsError(error))
            this.onError(error)
        }
      }
    })
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
  refresh(): void {
    if (!this.started)
      return
    const rules = getPageRules(this.options)
    const currentDirectories = new Set([
      ...this.roots,
      ...this.options.dirs.map(dir => normalizePath(path.resolve(this.options.root, dir))),
      ...this.options.subPackages.map(dir => normalizePath(path.resolve(this.options.root, dir))),
    ])
    for (const pattern of rules.patterns) {
      const portable = normalizePagePattern(pattern)
      if (!picomatch.scan(portable).isGlob) {
        currentDirectories.add(normalizePath(path.resolve(this.options.root, unescapePagePattern(portable))))
      }
      else if (this.options.mergePages) {
        for (const directory of resolvePageDirs(pattern, this.options.root, this.options.exclude))
          currentDirectories.add(normalizePath(path.resolve(this.options.root, directory)))
      }
    }
    this.roots = new Set([...currentDirectories].filter(source => this.options.mergePages && rules.matchesDirectory(source)))
    const isExcluded = rules.createExcludeFilter()
    const sources = collectPageWatchSources(this.roots, source => isExcluded(source) || this.ignoresSource(source))
    this.rules = rules
    this.directories = sources.directories
    this.files = sources.files
    this.links = sources.links
    this.reconcile()
  }

  fileForEvent(file: string, identity: string): string | undefined {
    const absolute = normalizePath(path.resolve(this.options.root, file))
    if (isTargetFile(absolute) && isPageFileInDirectories(absolute, this.options) && !this.ignoresSource(absolute))
      return absolute
    for (const [source, { target }] of this.files) {
      if (target === identity && isPageFileInDirectories(source, this.options) && !this.ignoresSource(source) && resolveWatchTarget(source).target === target)
        return source
    }
    for (const [source, { target }] of this.directories) {
      if (!contains(target, identity) || resolveWatchTarget(source).target !== target)
        continue
      const lexical = normalizePath(path.join(source, path.relative(target, identity)))
      if (isTargetFile(lexical) && isPageFileInDirectories(lexical, this.options) && !this.ignoresSource(lexical) && resolveWatchTarget(lexical).target === identity)
        return lexical
    }
  }

  directoryForEvent(directory: string): boolean {
    if (!this.options.mergePages)
      return false
    const absolute = normalizePath(path.resolve(this.options.root, directory))
    if (!this.ignoresSource(absolute) && (getPageRules(this.options).matchesDirectory(absolute) || [...this.directories.keys()].some(source => contains(absolute, source))))
      return true
    return [...this.directories, ...this.files].some(([source, { target }]) =>
      contains(absolute, target)
      && (isPageDirectoryEvent(source, this.options) || isPageFileInDirectories(source, this.options))
      && !this.ignoresSource(source)
      && resolveWatchTarget(source).target === target,
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
    const directories = [...this.directories.values()].filter(source => source.exists)
    const covered = (target: string): boolean => directories.some(directory => directory.target !== target && contains(directory.target, target))
    const wanted = new Set<string>()
    // 所有来源共同决定物理订阅；目录覆盖的文件目标不再重复注册
    for (const target of [...directories, ...this.files.values()].filter(source => source.exists)) {
      if (!covered(target.target))
        wanted.add(target.target)
    }
    // 别名集合变化也可能改变词法过滤结果，目标相同仍需重新应用过滤
    const key = this.sourceSignature()
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
        this.watcher.add([...wanted])
      }
      this.contentKey = key
      this.contentRules = this.rules
    }
    this.refreshEntrances()
  }

  private refreshFromEntrance(): void {
    try {
      const previous = this.sourceSignature()
      this.refresh()
      if (this.sourceSignature() !== previous)
        this.onStructure()
    }
    catch (error) {
      this.onError(error)
    }
  }

  private queueSourceRefresh(): void {
    if (this.sourceRefreshQueued)
      return
    this.sourceRefreshQueued = true
    // raw 回调结束后 chokidar 还要派发内容事件，不能在其遍历监听器时关闭实例
    queueMicrotask(() => {
      this.sourceRefreshQueued = false
      if (this.started)
        this.refreshFromEntrance()
    })
  }

  private sourceSignature(): string {
    // 文件原子替换只改变内容；目录身份变化则需要重新建立子树订阅
    return JSON.stringify([...this.directories, ...this.files]
      .map(([source, { target, exists, kind, identity }]) => [source, target, exists, kind, kind === 'directory' ? identity : null])
      .sort(([a], [b]) => String(a).localeCompare(String(b))))
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
        const portable = normalizePagePattern(pattern)
        const normalized = path.posix.normalize(portable)
        const scan = picomatch.scan(normalized, { parts: true })
        if (!scan.isGlob)
          continue
        const base = normalizePath(path.resolve(this.options.root, unescapePagePattern(scan.base || '.')))
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
        const stat = fs.statSync(directory, { bigint: true })
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
              this.queueSourceRefresh()
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
