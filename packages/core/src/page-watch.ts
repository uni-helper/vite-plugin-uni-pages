import type { ChokidarOptions, FSWatcher } from 'chokidar'
import type { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import type { WatchOptions } from 'vite'
import type { SourceTarget } from './page-watch-sources'
import type { ScanPlan } from './scan-plan'
import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import picomatch from 'picomatch'
import { globSync } from 'tinyglobby'
import { normalizePath } from 'vite'
import { isPageDirectoryEvent, isPageFileInDirectories, normalizePagePattern, unescapePagePattern } from './directories'
import { isMissingFsError, isTargetFile } from './files'
import { getPageRules } from './page-rules'
import { createPageWatchFilter } from './page-watch-filter'
import { collectPageWatchSources, isUnavailableSourceError, PAGE_WATCH_SOURCE_LIMIT, resolveWatchTarget } from './page-watch-sources'
import { createScanPlan } from './scan-plan'

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
    // 不可读目录按不可用处理：监听发现是辅助能力，不能让它中断页面生成
    if (!isMissingFsError(error) && !isUnavailableSourceError(error) && (error as NodeJS.ErrnoException).code !== 'ELOOP')
      throw error
    return false
  }
}

/**
 * 一轮监听刷新内复用的 Vite ignored 判定
 *
 * 监听检查沿候选路径逐级询问 ignored，同一批页面共享的祖先目录会在
 * 大量候选之间重复出现。每个路径在一轮内只求值一次，stat 次数从
 * “候选数 × 深度”降到“路径数”。来源结构或权限变化由下一次 refresh
 * 的 clear() 重新计算。
 */
export class SourceIgnoreIndex {
  private readonly verdicts = new Map<string, boolean>()

  constructor(private readonly ignored: (file: string, stats?: Stats) => boolean) {}

  /** 丢弃本轮结论；新的来源结构、忽略规则或权限要重新询问 */
  clear(): void {
    this.verdicts.clear()
  }

  /** 判定路径是否被忽略；祖先结论会被后代复用 */
  matches(file: string, stats?: Stats): boolean {
    const cached = this.verdicts.get(file)
    if (cached !== undefined)
      return cached
    let entry = stats
    if (!entry) {
      try {
        entry = fs.statSync(file, { throwIfNoEntry: false })
      }
      catch (error) {
        // 不可读路径无法建立有效订阅；按已忽略处理，不能借权限问题中断生成
        if (isUnavailableSourceError(error)) {
          this.verdicts.set(file, true)
          return true
        }
        if (!isMissingFsError(error) && (error as NodeJS.ErrnoException).code !== 'ELOOP')
          throw error
      }
    }
    if (this.ignored(file, entry)) {
      this.verdicts.set(file, true)
      return true
    }
    const parent = normalizePath(path.dirname(file))
    const inherited = parent === file ? false : this.matches(parent)
    this.verdicts.set(file, inherited)
    return inherited
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
  private warnedSourceLimit = false
  private usePolling = false
  private interval = 100
  private awaitWriteFinish: ChokidarOptions['awaitWriteFinish']
  private atomic: ChokidarOptions['atomic']
  private ignored: ((file: string, stats?: Stats) => boolean) | undefined
  /** 当前 ignored 规则的判定缓存，随刷新清空 */
  private sourceIgnored: SourceIgnoreIndex | undefined
  watcher?: FSWatcher

  constructor(
    private readonly options: ResolvedOptions,
    private readonly onFile: (event: 'add' | 'change' | 'unlink', file: string) => void,
    private readonly onStructure: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly onWarning: (message: string) => void = () => {},
  ) {
    this.rules = getPageRules(options)
  }

  /** 内容监听是否已建立；启动失败时调用方可用其他事件源重试 */
  get running(): boolean {
    return this.started
  }

  start(options: Pick<ChokidarOptions, 'usePolling' | 'interval' | 'cwd' | 'awaitWriteFinish' | 'atomic'> = {}, ignored?: WatchOptions['ignored'], plan?: ScanPlan): void {
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
    this.sourceIgnored = this.ignored ? new SourceIgnoreIndex(this.ignored) : undefined
    this.started = true
    try {
      this.refresh(plan ?? createScanPlan(this.options))
    }
    catch (error) {
      // 初始化失败不能留下 started=true 的僵尸实例；调用方可在后续生成时重试 start
      this.started = false
      throw error
    }
  }

  private ignoresSource(source: string, stats?: Stats): boolean {
    return this.sourceIgnored?.matches(source, stats) ?? false
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
  refresh(plan: ScanPlan): void {
    if (!this.started)
      return
    // 来源结构、忽略规则或权限可能变了，本轮重新询问 Vite ignored
    this.sourceIgnored?.clear()
    const rules = plan.rules
    // 保留上一轮的根：glob 匹配到的目录被删除后虽然不在本轮展开结果里，
    // 仍要从其父目录观察重建
    const currentDirectories = new Set([
      ...this.roots,
      ...plan.mainDirs.map(dir => normalizePath(path.resolve(this.options.root, dir))),
      ...plan.subPackageDirs.map(dir => normalizePath(path.resolve(this.options.root, dir))),
    ])
    // 字面目录即使尚未创建也要观察；glob 的现有匹配已包含在计划目录里
    for (const pattern of rules.patterns) {
      const portable = normalizePagePattern(pattern)
      if (!picomatch.scan(portable).isGlob)
        currentDirectories.add(normalizePath(path.resolve(this.options.root, unescapePagePattern(portable))))
    }
    this.roots = new Set([...currentDirectories].filter(source => this.options.mergePages && rules.matchesDirectory(source)))
    const isExcluded = rules.createExcludeFilter()
    const sources = collectPageWatchSources(this.roots, source => isExcluded(source) || this.ignoresSource(source))
    this.rules = rules
    this.directories = sources.directories
    this.files = sources.files
    this.links = sources.links
    this.reconcile()
    if (sources.truncated) {
      if (!this.warnedSourceLimit) {
        this.warnedSourceLimit = true
        this.onWarning(`Page watch discovery reached the ${PAGE_WATCH_SOURCE_LIMIT} linked-source safety limit and stopped expanding this round. Pages are still generated, but sources beyond the limit are not watched while it is reached. Narrow the page roots or exclude unused links to restore full watch coverage.`)
      }
    }
    else {
      this.warnedSourceLimit = false
    }
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
    this.sourceIgnored = undefined
    this.warnedSourceLimit = false
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
      // 入口变化可能带来新的 glob 目录；重新生成计划，避免只观察旧目录
      this.refresh(createScanPlan(this.options))
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
        // 入口目录暂时不可读时跳过本轮观察，权限恢复后由后续刷新重建
        if (!isMissingFsError(error) && !isUnavailableSourceError(error))
          this.onError(error)
      }
    }
  }
}
