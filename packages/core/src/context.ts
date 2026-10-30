import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar, TabBarItem } from '@uni-helper/uni-pages-types'
import type { FSWatcher } from 'chokidar'
import type { Logger, ModuleNode, ViteDevServer } from 'vite'
import type { SubPackageDirectorySource } from './directories'
import type { PageEnvironment } from './page'
import type { PageCandidate, PageSource } from './page-sources'
import type { PagesSnapshot } from './pages-snapshot'
import type { ScanPlan } from './scan-plan'
import type { InternalPages, PagePath, ResolvedOptions, UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { platform as uniEnvPlatform } from '@uni-helper/uni-env'
import { stringify as cjStringify } from 'comment-json'
import dbg from 'debug'
import groupBy from 'lodash.groupby'
import { normalizePath } from 'vite'
import { normalizeConfigPath, PagesConfigLoader } from './config-loader'
import { buildConfigWatchPlan, ConfigWatchIndex } from './config-watch'
import { RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import { writeDeclaration } from './declaration'
import { checkPagesJsonFileSync, getPageFiles, isTargetFile, resolvePagesJsonPath } from './files'
import { debug } from './logger'
import { resolveOptions } from './options'
import { Page } from './page'
import { comparePageSources, resolvePageIdentity, selectPageSources, validateGeneratedRoutes } from './page-sources'
import { PageSourceWatch } from './page-watch'
import { writePagesJson } from './pages-json'
import { createPagesSnapshot } from './pages-snapshot'
import { applyScanPlan, createScanPlan } from './scan-plan'

/**
 * 在 watcher 回调里查页面规则
 *
 * 规则会在声明变化后重新编译，编译失败属于配置错误；此时记日志并按
 * “不是页面事件”处理，异常不能穿过 watcher 回调，否则会崩在事件循环里。
 */
function queryPageRules<T>(fallback: T, query: () => T): T {
  try {
    return query()
  }
  catch (error) {
    debug.error('Failed to evaluate page rules, the event is ignored:', error)
    return fallback
  }
}

/**
 * 页面上下文：负责扫描页面、加载配置、合并页面信息、生成 pages.json
 *
 * 做的事情按固定顺序是：加载用户配置 → 扫描页面文件 → 合并页面
 * 信息 → 写入 pages.json。这个顺序由 {@link updatePagesJSON}（完整
 * 流程）或 {@link scanAndMerge}（只算不写）管理，调用方不用关心
 * 内部步骤。
 */
export class PageContext {
  private _server: ViteDevServer | undefined
  private readonly configLoader: PagesConfigLoader
  private readonly watchers = new Map<FSWatcher, () => void>()
  private readonly watchedConfigPaths = new Map<FSWatcher, Set<string>>()
  /** 当前配置依赖与恢复范围；事件判定和路径展开都从这里取 */
  private readonly configWatch: ConfigWatchIndex
  /** 生成物（pages.json、d.ts）的绝对路径，只在首次事件时算一次 */
  private generatedPathsCache: string[] | undefined
  private pendingUpdate: Promise<void> = Promise.resolve()
  private disposed = false
  private disposal: Promise<void> | undefined
  /** 本轮扫描的目录、分包来源与规则；扫描和监听共用 */
  private scanPlan: ScanPlan | undefined
  /** 最近一次生成的完整快照；虚拟模块、路由与声明都读它 */
  private generatedSnapshot: PagesSnapshot | undefined
  /** 随扫描更新的 Page 来源，用于复用检查和冲突诊断 */
  private readonly pageSources = new WeakMap<Page, PageSource>()
  /** 扫描候选独立于归属裁剪后的输出映射，保留非代表来源的内容缓存 */
  private mainPageCandidates = new Map<string, Page>()
  private subPageCandidates = new Map<string, Map<string, Page>>()
  private readonly pageWatcher: PageSourceWatch
  /** 待处理的页面更新：生成期间到达的事件合并到下一轮 */
  private pendingPageUpdate: { full: boolean, files: Set<string> } | undefined
  /** 当前事件更新循环；dispose 时等待它排空 */
  private pendingPageFlush: Promise<void> | undefined
  /** 页面监听启动参数；初始化失败时保留，后续生成会重试 */
  private pageWatcherStart: { options: Parameters<PageSourceWatch['start']>[0], ignored: Parameters<PageSourceWatch['start']>[1] } | undefined

  /** 当前配置本地依赖及加载失败后仍需监听的恢复路径 */
  pagesConfigDependencyPaths: string[] = []

  /** 从用户配置文件（pages.config.ts）解析出的配置对象 */
  pagesGlobConfig: PagesConfig | undefined
  /** 用户配置文件的来源路径列表 */
  pagesConfigSourcePaths: string[] = []

  /** 主包页面映射，键为页面文件的词法绝对路径 */
  pages = new Map<string, Page>()
  /** 分包页面映射，外层键为词法扫描目录，内层键为页面文件的词法绝对路径 */
  subPages = new Map<string, Map<string, Page>>()
  /** 主包页面配置数组，用于生成 pages.json 的 pages 字段 */
  pageMetaData: InternalPages = []
  /** 分包页面配置数组，用于生成 pages.json 的 subPackages 字段 */
  subPageMetaData: SubPackages = []
  /**
   * 最近一次合并出的 tabBar（配置文件与 definePage 声明的合体）。
   * 类型声明生成 tab 页列表时用它，definePage 声明的 tabBar 页才能
   * 一起从 navigateTo 的 url 类型里排除
   */
  tabBar: TabBar | undefined

  /** 生成的 pages.json 文件路径 */
  resolvedPagesJSONPath = ''

  /** 项目根目录 */
  root: string
  /** 解析后的配置项 */
  options: ResolvedOptions
  /** 当前平台标识，如 'mp-weixin'；由调用方传入，不依赖模块加载时冻结的环境 */
  readonly platform: string
  logger?: Logger

  /** 是否与 vite-plugin-uni-platform 插件协同工作 */
  withUniPlatform = false

  /** pages.json 中页面路径的解析基准路径 */
  private get basePath(): string {
    return this.scanPlan?.basePath ?? resolveBasePath(this.options)
  }

  /**
   * 创建 PageContext 实例
   * @param userOptions - 用户配置项
   * @param viteRoot - Vite 项目根目录，默认为当前工作目录
   * @param platform - 当前平台标识，默认取 uni-env 的平台
   */
  constructor(userOptions: UserOptions, viteRoot: string = process.cwd(), platform: string = uniEnvPlatform) {
    this.root = normalizePath(viteRoot)
    this.configLoader = new PagesConfigLoader(this.root)
    this.configWatch = new ConfigWatchIndex(this.root, this.configLoader.artifactDirectory)
    this.platform = platform
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    this.pageWatcher = new PageSourceWatch(
      this.options,
      (event, file) => {
        const pageFile = queryPageRules(undefined, () => this.pageFileForEvent(file, normalizeConfigPath(file, this.root)))
        if (pageFile) {
          debug.pages(`File changed: ${pageFile}`)
          this.queuePageUpdate(event === 'change' ? pageFile : undefined)
        }
      },
      () => this.queuePageUpdate(),
      error => this.logUpdateFailure(error),
      message => this.logger?.warn(message, { timestamp: true }),
    )
    // 调试日志逻辑
    const debugOption = this.options.debug
    if (debugOption) {
      const prefix = 'vite-plugin-uni-pages:'
      const suffix = typeof debugOption === 'boolean' ? '*' : debugOption
      dbg.enable(`${prefix}${suffix}`)
    }
    this.resolvedPagesJSONPath = resolvePagesJsonPath(this.root, this.options.outDir)
    debug.options(this.options)
  }

  /**
   * 设置 Vite logger
   * @param logger - Vite logger 实例
   */
  setLogger(logger: Logger): void {
    this.logger = logger
  }

  /**
   * 设置配置图里 import.meta.env 的值
   *
   * @description Vite 解析完用户配置后才有真实 env；prepare() 先跑时由这里补上，后续重新加载生效
   * @param env - 与 Vite 给 app 代码注入的 import.meta.env 一致的值
   */
  setConfigEnv(env: Record<string, unknown>): void {
    this.configLoader.setEnv(env)
  }

  /**
   * 加载用户页面配置文件（如 pages.config.ts）
   * 使用 unconfig 加载配置，支持多种配置文件格式
   */
  async loadUserPagesConfig(): Promise<void> {
    try {
      const { config, sources, dependencies } = await this.configLoader.load(this.options.configSource)
      this.pagesGlobConfig = config.default || config
      this.pagesConfigSourcePaths = sources
      this.pagesConfigDependencyPaths = dependencies
      debug.options(this.pagesGlobConfig)
    }
    catch (error) {
      // 加载器已保留上次成功的依赖并补入本轮恢复路径
      this.pagesConfigDependencyPaths = [...this.configLoader.watchInput.dependencies]
      throw error
    }
    finally {
      this.refreshConfigWatchers()
    }
  }

  /**
   * 按顺序跑完扫描与合并：先扫描主包和分包的页面，再合并它们的
   * 信息。步骤顺序只维护在这里，调用方和测试都不用关心。
   */
  async scanAndMerge(): Promise<void> {
    this.generatedSnapshot = undefined
    this.refreshScanPlan()
    await this.scanPages()
    await this.scanSubPages()
    this.startPageWatcher()
    this.pageWatcher.refresh(this.requireScanPlan())
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
  }

  /** 刷新本轮扫描计划，并同步兼容投影供既有调用方读取 */
  private refreshScanPlan(): void {
    this.scanPlan = createScanPlan(this.options)
    applyScanPlan(this.options, this.scanPlan)
  }

  /** 扫描与监听阶段读取本轮计划；计划在 refreshScanPlan 之后必定存在 */
  private requireScanPlan(): ScanPlan {
    if (!this.scanPlan)
      throw new Error('[vite-plugin-uni-pages] Scan plan is not ready')
    return this.scanPlan
  }

  /**
   * 设置 Vite 开发服务器，用于 HMR 与文件监听
   * @param server - Vite 开发服务器实例
   */
  setupViteServer(server: ViteDevServer): void {
    if (this.disposed || this._server === server)
      return

    this._server = server
    // Vite 5 内部使用 chokidar v3；其 watcher 在运行时与 chokidar v5 的 API 兼容
    void this.setupWatcher(server.watcher as unknown as FSWatcher).catch(error => this.logUpdateFailure(error))
  }

  /**
   * 生成物（pages.json 与 d.ts）的绝对路径
   *
   * 只依赖构造后不再变化的 `options` 与 `resolvedPagesJSONPath`，
   * 算一次缓存即可，不必每个事件重新解析
   */
  private generatedFilePaths(): string[] {
    if (!this.generatedPathsCache) {
      this.generatedPathsCache = [
        normalizeConfigPath(this.resolvedPagesJSONPath, this.root),
        ...this.options.dts ? [normalizeConfigPath(this.options.dts, this.root)] : [],
      ]
    }
    return this.generatedPathsCache
  }

  /** 按当前词法规则识别页面事件，真实路径只用于关联已收录来源 */
  private pageFileForEvent(file: string, identity: string): string | undefined {
    return this.pageWatcher.fileForEvent(file, identity)
  }

  private pageDirectoryForEvent(directory: string): boolean {
    return this.pageWatcher.directoryForEvent(directory)
  }

  /**
   * 注册配置文件与页面目录结构监听，并启动页面内容监听
   *
   * @param watcher - 配置文件及目录结构事件使用的 chokidar 监听器
   */
  async setupWatcher(watcher: FSWatcher): Promise<void> {
    if (this.disposed || this.watchers.has(watcher))
      return

    const onConfigFile = (filepath: string): void => {
      const absolute = this.configWatch.match(filepath, this.generatedFilePaths())
      if (!absolute)
        return

      debug.pages(`Config changed: ${absolute}`)
      void this.updatePagesAndNotify()
    }
    const onDirectory = (directory: string): void => {
      if (queryPageRules(false, () => this.pageDirectoryForEvent(directory)))
        this.queuePageUpdate()
    }
    // 自有内容监听启动失败时，共享 watcher 仍会收到页面事件；用它重试
    // 启动，避免一次临时文件系统错误让整个会话不再跟随页面变化
    const onSharedPageFile = (filepath: string): void => {
      if (this.disposed || this.pageWatcher.running || !this.pageWatcherStart)
        return
      if (!isTargetFile(normalizePath(filepath)))
        return
      this.startPageWatcher()
      if (this.pageWatcher.running)
        this.queuePageUpdate()
    }
    // 配置首次加载与订阅就绪之间的变化可能被 ignoreInitial 吞掉
    const onReady = (): void => this.queuePageUpdate()
    watcher.on('add', onConfigFile)
    watcher.on('change', onConfigFile)
    watcher.on('unlink', onConfigFile)
    watcher.on('add', onSharedPageFile)
    watcher.on('change', onSharedPageFile)
    watcher.on('unlink', onSharedPageFile)
    watcher.on('addDir', onDirectory)
    watcher.on('unlinkDir', onDirectory)
    watcher.on('ready', onReady)
    this.watchers.set(watcher, () => {
      watcher.off('add', onConfigFile)
      watcher.off('change', onConfigFile)
      watcher.off('unlink', onConfigFile)
      watcher.off('add', onSharedPageFile)
      watcher.off('change', onSharedPageFile)
      watcher.off('unlink', onSharedPageFile)
      watcher.off('addDir', onDirectory)
      watcher.off('unlinkDir', onDirectory)
      watcher.off('ready', onReady)
    })
    this.watchedConfigPaths.set(watcher, new Set())
    this.refreshConfigWatchers()
    const watchDisabled = (this._server?.watcher as unknown) === watcher && this._server?.config.server.watch === null
    if (!watchDisabled) {
      this.pageWatcherStart = {
        options: watcher.options,
        ignored: (this._server?.watcher as unknown) === watcher ? this._server?.watcher.options.ignored : undefined,
      }
      this.startPageWatcher()
    }
  }

  /**
   * 启动页面监听
   *
   * @description 初始化失败只记录并保留启动参数，后续生成会重新尝试；监听属于辅助
   * 能力，不能阻断页面生成，也不能留下未处理的拒绝
   */
  private startPageWatcher(): void {
    if (this.disposed || !this.pageWatcherStart)
      return
    try {
      this.pageWatcher.start(this.pageWatcherStart.options, this.pageWatcherStart.ignored, this.scanPlan)
    }
    catch (error) {
      this.logUpdateFailure(error)
    }
  }

  /**
   * 释放本上下文的监听与待处理更新
   *
   * @description 关闭后不再接受监听注册或更新；已开始的生成会完成，重复调用等待同一次释放
   * 共享 watcher 的关闭仍由 Vite 负责
   */
  async disposeWatchers(): Promise<void> {
    if (this.disposal)
      return this.disposal
    this.disposed = true
    this.pendingPageUpdate = undefined
    for (const dispose of this.watchers.values())
      dispose()
    this.watchers.clear()
    this.watchedConfigPaths.clear()
    this._server = undefined
    this.pageWatcherStart = undefined
    this.disposal = (async () => {
      try {
        await this.pageWatcher.close()
      }
      finally {
        await this.pendingPageFlush
        await this.pendingUpdate
      }
    })()
    return this.disposal
  }

  /** 补充未覆盖的监听路径，注册成功后记账，失败时保留重试机会 */
  private addWatchPaths(watcher: FSWatcher, paths: readonly string[], added: Set<string>, description: string): void {
    const wanted = paths.filter(file => !added.has(file)
      && ![...added].some(existing => file.startsWith(`${existing}/`)))
    if (!wanted.length)
      return
    try {
      // add() 返回 watcher，注册异步完成；这里只能捕获同步异常
      watcher.add(wanted)
      for (const file of wanted)
        added.add(file)
    }
    catch (error) {
      this.logger?.error(`Failed to watch ${description}: ${error instanceof Error ? error.message : error}`, { timestamp: true, error: error instanceof Error ? error : undefined })
    }
  }

  /**
   * 让监听路径与当前配置依赖保持一致
   *
   * 只新增路径，从不 unwatch：chokidar 对文件调用 unwatch 会连带
   * 拆掉父目录监听，新建文件就再也发现不了。因此监听集合是并集，
   * 会随着会话累积；每次刷新都按当前依赖重建配置监听计划，
   * 真正决定是否触发的始终是计划里的依赖集合（恢复目录除外，那是
   * 故意留的兜底）。
   */
  private refreshConfigWatchers(): void {
    // 临时产物目录在计划构建时排除，避免加载器写入和清理文件触发配置重载
    this.configWatch.update(buildConfigWatchPlan({
      root: this.root,
      artifactDirectory: this.configLoader.artifactDirectory,
      sourcePaths: this.pagesConfigSourcePaths,
      dependencyPaths: this.pagesConfigDependencyPaths,
      recoveryCandidates: this.configLoader.watchInput.recoveryCandidates,
      recoveryDirectories: this.configLoader.watchInput.recoveryDirectories,
    }))
    for (const watcher of this.watchers.keys()) {
      const added = this.watchedConfigPaths.get(watcher)!
      const sharedRoot = this._server && watcher === (this._server.watcher as unknown as FSWatcher)
        ? normalizeConfigPath(this._server.config.root, this.root)
        : undefined
      // sharedRoot 由 Vite 自己监听，不重复添加也不能撤销
      this.addWatchPaths(watcher, this.configWatch.watchPaths(sharedRoot), added, 'pages config dependencies')
    }
  }

  /** 配置变化的完整更新：失败只记录，不让 Promise 拒绝 */
  private async updatePagesAndNotify(): Promise<void> {
    try {
      if (await this.updatePagesJSON() && !this.disposed)
        this.onUpdate()
    }
    catch (error) {
      this.logUpdateFailure(error)
    }
  }

  /** 记录 watcher 更新失败，避免未处理的拒绝终止进程 */
  private logUpdateFailure(error: unknown): void {
    this.logger?.error(`Failed to update pages.json after a file change: ${error instanceof Error ? error.message : error}`, { timestamp: true, error: error instanceof Error ? error : undefined })
  }

  /**
   * 登记页面事件触发的更新：生成期间到达的事件合并到下一轮
   *
   * @description 连续删除、重建会一次性派发大量事件，逐个生成会反复
   * 重读全部页面；内容变更合并待刷新文件，结构变更执行完整刷新
   * @param filepath - 只读取该页面；省略时执行完整扫描
   */
  private queuePageUpdate(filepath?: string): void {
    if (this.disposed)
      return
    if (!this.pendingPageUpdate)
      this.pendingPageUpdate = { full: false, files: new Set() }
    if (filepath)
      this.pendingPageUpdate.files.add(filepath)
    else
      this.pendingPageUpdate.full = true
    if (!this.pendingPageFlush)
      this.pendingPageFlush = this.flushPageUpdates()
  }

  /**
   * 排空页面事件队列；失败只记录，不让 Promise 拒绝
   *
   * 页面事件的回调走这里而不是直接调 {@link updatePagesJSON}：一旦
   * 它拒绝（拿不到文件锁、声明文件写不进去），就成了未处理的拒绝，
   * Node 默认直接终止进程。开发时正在编辑文件，一次偶发的锁冲突
   * 不该把 dev server 打死。用户改一次文件就会再触发一次事件，
   * 所以这里报错即可。
   */
  private async flushPageUpdates(): Promise<void> {
    try {
      while (this.pendingPageUpdate) {
        const { full, files } = this.pendingPageUpdate
        this.pendingPageUpdate = undefined
        try {
          const updated = full
            ? await this.updatePagesJSON()
            : files.size === 1
              ? await this.updatePagesJSON([...files][0])
              : await this.enqueuePagesUpdate([...files])
          if (updated && !this.disposed)
            this.onUpdate()
        }
        catch (error) {
          this.logUpdateFailure(error)
        }
      }
    }
    finally {
      this.pendingPageFlush = undefined
    }
  }

  /**
   * 页面更新回调，页面文件或配置变化时触发
   * 负责使虚拟模块失效并通知浏览器整页刷新
   */
  onUpdate(): void {
    if (!this._server)
      return

    invalidatePagesModule(this._server)
    debug.hmr('Reload generated pages.')
    this._server.ws.send({
      type: 'full-reload',
    })
  }

  /**
   * 刷新页面配置并更新 pages.json
   *
   * @description 同一实例的调用按顺序执行；指定页面时尝试增量读取，页面尚未收录或物理身份变化时执行完整刷新
   *
   * @param filepath 变更页面的绝对路径或相对 root 的路径；省略时执行完整刷新
   * @returns pages.json 写入新内容时为 `true`，内容未变、上下文已关闭或跳过生成时为 `false`
   * @throws 生成、写入或声明输出失败时拒绝；声明输出失败前 pages.json 可能已更新
   */
  async updatePagesJSON(filepath?: string): Promise<boolean> {
    return this.enqueuePagesUpdate(filepath ? [filepath] : undefined)
  }

  private enqueuePagesUpdate(files?: readonly string[]): Promise<boolean> {
    if (this.disposed)
      return Promise.resolve(false)
    const update = this.pendingUpdate.then(() => this.disposed ? false : this.generatePagesJSON(files))
    this.pendingUpdate = update.then(() => {}, () => {})
    return update
  }

  private async generatePagesJSON(files?: readonly string[]): Promise<boolean> {
    const candidates = files?.map(file => this.findPages(file))
    // 未收录文件或身份变化需要完整刷新，不能沿用旧来源的内容缓存
    const incremental = !!candidates?.length && candidates.every(pages => pages.length > 0)
    if (incremental) {
      const pages = [...new Set(candidates.flat())]
      await Promise.all(pages.map(page => page.read()))
      if (!pages.some(page => page.hasChanged())) {
        debug.cache('Page metadata is unchanged, skipping generation')
        return false
      }
    }

    this.generatedSnapshot = undefined
    checkPagesJsonFileSync(this.resolvedPagesJSONPath)
    this.options.onBeforeLoadUserConfig()
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this.pagesGlobConfig)

    if (this.options.mergePages) {
      // hook 可能新建扫描目录（例如 glob 匹配的新目录），计划要在 hook 之后生成
      this.options.onBeforeScanPages()
      this.refreshScanPlan()
      await this.scanPages(!incremental)
      await this.scanSubPages(!incremental)
      this.options.onAfterScanPages(this.pages, this.subPages)
      this.startPageWatcher()
      this.pageWatcher.refresh(this.requireScanPlan())
    }

    this.options.onBeforeMergePageMetaData(this.pages, this.pagesGlobConfig)
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
    this.options.onAfterMergePageMetaData(this.pageMetaData, this.subPageMetaData)

    const pages = this.withUniPlatform
      ? filterPlatformSuffixPages(this.pageMetaData, this.platform)
      : this.pageMetaData

    this.pageMetaData = dedupeByPath(pages)

    this.options.onBeforeWriteFile(this.resolvedPagesJSONPath)

    // 从 pages.json 合并回来的条目可能没有内部 `type` 标记（手写条目
    // 从不带它），所以从扫描结果里解析首页路径，交给 pages.json 模块
    // 做位置调整
    const homePath = this.pageMetaData.find(meta => meta.type === 'home')?.path

    // 整个"读 → 合并 → 写"都锁在 pages.json 模块里的同一把文件锁内，
    // 两个终端同时跑（dev:mp-weixin + dev:mp-alipay）也不会把彼此的
    // 条件编译输出写坏。tabBar 在这之前算好、存到 this.tabBar，
    // 后面的类型声明用同一份结果
    this.tabBar = await this.resolveTabBar()
    this.generatedSnapshot = createPagesSnapshot({
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
      tabBar: this.tabBar,
      globConfig: this.pagesGlobConfig,
      homePath,
    })
    const result = await writePagesJson(this.resolvedPagesJSONPath, {
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
      tabBar: this.tabBar,
      homePath,
    }, {
      platform: this.platform,
      globConfig: this.pagesGlobConfig,
      format: {
        minify: this.options.minify,
        indent: this.options.indent,
        eol: this.options.eol,
        insertFinalNewline: this.options.insertFinalNewline,
      },
    })
    if (!result)
      throw new Error(`[vite-plugin-uni-pages] Failed to acquire the pages.json file lock: ${this.resolvedPagesJSONPath}`)

    // 声明文件写的是另一个文件（uni-pages.d.ts），不需要和 pages.json
    // 用同一把锁。保持原有行为：不管内容变没变，都在 pages.json 计算
    // 之后运行
    try {
      await this.generateDeclaration()
    }
    catch (error) {
      // pages.json 已提交，声明失败也不能丢失写入回调和页面更新通知
      if (result.updated) {
        this.options.onAfterWriteFile(this.resolvedPagesJSONPath, result.content)
        this.onUpdate()
      }
      throw error
    }

    if (result.updated) {
      this.options.onAfterWriteFile(this.resolvedPagesJSONPath, result.content)
    }

    // 配置加载期间刚发现的依赖这时才进入监听集合，它在此之前发生的
    // 修改可能已经被启动时的索引过滤掉了。补跑一轮，用最新内容再生成
    // 一次；下一轮依赖集合没有扩大，不会再排下一次
    if (this.configWatch.consumeExpanded() && !this.disposed)
      this.queuePageUpdate()

    return result.updated
  }

  /** 最近一次生成的路由快照；未写入文件时由当前工作字段合成 */
  get snapshot(): PagesSnapshot {
    return this.generatedSnapshot ?? createPagesSnapshot({
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
      tabBar: this.tabBar,
      globConfig: this.pagesGlobConfig,
      homePath: this.pageMetaData.find(meta => meta.type === 'home')?.path,
    })
  }

  /**
   * 生成虚拟模块内容
   * 返回包含 pages 与 subPackages 导出的 JavaScript 代码
   * @returns 虚拟模块代码字符串
   */
  virtualModule(): string {
    const { pages, subPackages } = this.snapshot
    return [
      `export const pages = ${cjStringify(pages, null, 2)};`,
      `export const subPackages = ${cjStringify(subPackages, null, 2)};`,
    ].join('\n')
  }

  /**
   * 将主包路由数据解析为 JSON 字符串
   * @returns 主包页面配置的 JSON 字符串
   */
  resolveRoutes(): string {
    return cjStringify(this.snapshot.pages, null, 2)
  }

  /**
   * 将分包路由数据解析为 JSON 字符串
   * @returns 分包页面配置的 JSON 字符串
   */
  resolveSubRoutes(): string {
    return cjStringify(this.snapshot.subPackages, null, 2)
  }

  /**
   * 解析 tabBar 配置
   * 将页面定义的 tabBar 项与配置文件定义的 tabBar 合并
   * @returns 合并后的 tabBar 配置对象，无 tabBar 时为 undefined
   */
  async resolveTabBar(): Promise<TabBar | undefined> {
    const tabBarItems: (TabBarItem & { index: number })[] = []
    for (const [_, page] of this.pages) {
      const tabbar = await page.getTabBar()
      if (tabbar) {
        tabBarItems.push(tabbar)
      }
    }

    if (tabBarItems.length === 0) {
      return this.pagesGlobConfig?.tabBar
    }

    const tabBar = {
      ...this.pagesGlobConfig?.tabBar,
      list: this.pagesGlobConfig?.tabBar?.list || [],
    }

    const pagePaths = new Set(tabBar.list.map(item => item.pagePath))

    tabBarItems.sort((a, b) => a.index - b.index)

    for (const item of tabBarItems) {
      if (!pagePaths.has(item.pagePath)) {
        const { index: _, ...tabbar } = item
        tabBar.list.push(tabbar)
      }
    }

    return tabBar
  }

  /**
   * 生成 TypeScript 声明文件
   * 为页面路径生成类型定义，导航时提供类型提示
   */
  generateDeclaration(): Promise<void> | undefined {
    if (!this.options.dts)
      return

    debug.declaration('generating')
    return writeDeclaration(this.snapshot, this.options.dts)
  }

  /**
   * 按词法目录扫描主包页面
   *
   * @description 各目录分别执行文件排除，物理别名保留到页面有效性与归属决议阶段
   */
  private async scanPages(refreshContent = true): Promise<void> {
    const plan = this.requireScanPlan()
    const pages = new Map<string, Page>()
    for (const [matchIndex, dir] of plan.mainDirs.entries()) {
      for (const pagePath of getPagePaths(dir, this.options, plan.basePath)) {
        if (pages.has(pagePath.absolutePath))
          continue
        const page = this.trackPage(pagePath, this.pages.get(pagePath.absolutePath) ?? this.mainPageCandidates.get(pagePath.absolutePath), {
          dir,
          explicitRoot: false,
          ruleIndex: 0,
          matchIndex,
        }, refreshContent)
        if (page)
          pages.set(pagePath.absolutePath, page)
      }
    }
    debug.pages([...pages.keys()])
    this.mainPageCandidates = pages
    this.pages = new Map(pages)
  }

  /**
   * 登记本轮来源并复用身份与输出基准均未变化的 Page
   *
   * @description 整轮更新使读取缓存失效，增量更新复用目标页的预读结果与其他页面缓存
   * @returns 路径仍存在时返回页面实例，扫描期间已消失时为 undefined
   */
  private trackPage(pagePath: PagePath, previous: Page | undefined, source: Omit<PageSource, 'file' | 'identity'>, refreshContent: boolean): Page | undefined {
    const identity = resolvePageIdentity(pagePath.absolutePath)
    if (!identity)
      return
    // 符号链接换目标或相对输出路径变化后，旧宏结果和 URI 都不能沿用
    const page = previous && this.pageSources.get(previous)?.identity === identity
      && previous.path.relativePath === pagePath.relativePath
      ? previous
      : new Page(this.pageEnvironment(), pagePath)
    if (refreshContent)
      page.invalidate()
    this.pageSources.set(page, {
      file: pagePath.absolutePath,
      identity,
      dir: source.dir,
      root: source.root,
      explicitRoot: source.explicitRoot,
      ruleIndex: source.ruleIndex,
      matchIndex: source.matchIndex,
      rootSource: source.rootSource,
      rulePattern: this.configuredRule(source),
    })
    return page
  }

  private pageEnvironment(): PageEnvironment {
    // setLogger 可能在 Page 创建之后才调用，读取时再取当前 logger
    return { platform: this.platform, getLogger: () => this.logger }
  }

  /** 页面来源的原始声明规则，用于冲突诊断；hook 页面可能没有 */
  private configuredRule(source: Pick<PageSource, 'root' | 'ruleIndex'>): string | undefined {
    if (source.root === undefined)
      return this.options.dir
    const pattern = this.options.subPackagePatterns[source.ruleIndex]
    return typeof pattern === 'string' ? pattern : pattern?.dir
  }

  /**
   * 按词法路径或物理身份查找全部缓存候选
   * @param filepath - 页面文件的绝对路径
   * @returns 主包和分包中属于同一文件的页面实例，每个实例只返回一次
   */
  private findPages(filepath: string): Page[] {
    const absolute = normalizePath(path.resolve(this.root, filepath))
    const groups = [this.mainPageCandidates, ...this.subPageCandidates.values(), this.pages, ...this.subPages.values()]
    const identity = resolvePageIdentity(absolute)
    if (!identity)
      return []
    const matched = groups.flatMap(pages => [...pages.entries()].flatMap(([file, page]) => {
      const source = this.pageSources.get(page)
      return file === absolute || source?.identity === identity ? [page] : []
    }))
    if (matched.some(page => this.pageSources.get(page)?.identity !== identity || resolvePageIdentity(page.path.absolutePath) !== identity))
      return []
    return [...new Set(matched)]
  }

  /**
   * 按词法来源扫描分包页面
   *
   * @description 同一物理目录的不同别名仍分别执行文件排除，避免某个别名被排除后漏页
   */
  private async scanSubPages(refreshContent = true): Promise<void> {
    const plan = this.requireScanPlan()
    const paths: Record<string, PagePath[]> = {}
    const subPages = new Map<string, Map<string, Page>>()
    const sources = this.subPackageSourcesByDir()
    for (const [dir, source] of sources) {
      const pagePaths = getPagePaths(dir, this.options, plan.basePath)
      paths[dir] = pagePaths

      const pages = new Map<string, Page>()
      for (const pagePath of pagePaths) {
        const page = this.trackPage(pagePath, this.subPages.get(dir)?.get(pagePath.absolutePath) ?? this.subPageCandidates.get(dir)?.get(pagePath.absolutePath), source, refreshContent)
        if (page)
          pages.set(pagePath.absolutePath, page)
      }
      subPages.set(dir, pages)
    }
    debug.subPages(JSON.stringify(paths, null, 2))

    this.subPageCandidates = subPages
    this.subPages = new Map([...subPages].map(([dir, pages]) => [dir, new Map(pages)]))
  }

  /**
   * 为每个物理扫描目录选取声明来源
   *
   * @description 同一路径的不同写法只扫描一次，定位信息按显式优先选择；
   * 符号链接别名是不同的 absolute，仍分别保留各自的词法路径
   */
  private subPackageSourcesByDir(): Map<string, SubPackageDirectorySource> {
    const selected = new Map<string, SubPackageDirectorySource>()
    // 计划只在 scanAndMerge 之后才可能被调用；为空说明目录尚未扫描，不能在此重新发现
    const sources = this.scanPlan?.subPackageSources ?? []
    for (const source of sources) {
      const previous = selected.get(source.absolute)
      if (!previous || comparePageSources(source, previous) < 0)
        selected.set(source.absolute, source)
    }
    return new Map([...selected.values()].map(source => [source.dir, source]))
  }

  /** 获取目录的最终分包 root，未登记时相对 outDir 计算默认值 */
  private subPackageRoot(dir: string): string {
    return this.scanPlan?.subPackageRootMap.get(dir)
      ?? this.options.subPackageRootMap.get(dir)
      ?? normalizePath(path.relative(this.basePath, path.resolve(this.options.root, dir)))
  }

  /**
   * 决议有效页面的归属并校验生成路由
   *
   * @description 先读取宏并应用既有平台规则，再选择代表；冲突校验通过后才裁剪页面映射，
   * 配置覆盖与输出去重在此之后执行
   */
  private async resolveScanSources(): Promise<void> {
    const candidates: PageCandidate[] = []
    // 关闭页面合并时没有扫描结果，不需要为空的来源集合再展开一次目录
    const subSources = this.options.mergePages ? this.subPackageSourcesByDir() : new Map<string, SubPackageDirectorySource>()
    const groups: [string | undefined, Map<string, Page>][] = [[undefined, this.pages], ...this.subPages]
    // 宏可能异步求值，保持并行读取，来源决议仍按原顺序
    await Promise.all(groups.flatMap(([, pages]) => [...pages.values()].map(page => page.ensureLoaded())))
    for (const [dir, pages] of groups) {
      const root = dir === undefined ? undefined : this.subPackageRoot(dir)
      for (const [file, page] of pages) {
        if (page.skipped)
          continue
        const meta = await page.getPageMeta()
        const effective = dir === undefined && this.withUniPlatform
          ? filterPlatformSuffixPages([meta], this.platform)[0]
          : meta
        if (!effective)
          continue
        // 扫描后的 hook 可以加入 Page，缺少扫描记录时从当前路径和目录补齐来源
        const original = this.pageSources.get(page)
        const identity = original?.identity ?? resolvePageIdentity(file)
        if (!identity)
          continue
        const source = dir === undefined ? undefined : subSources.get(dir)
        const ruleIndex = source?.ruleIndex ?? original?.ruleIndex ?? this.options.subPackages.indexOf(dir!)
        candidates.push({
          ...original,
          ...source,
          page,
          file,
          identity,
          dir: dir ?? original?.dir ?? this.options.dir,
          root,
          explicitRoot: source?.explicitRoot ?? original?.explicitRoot ?? false,
          ruleIndex,
          matchIndex: source?.matchIndex ?? original?.matchIndex ?? 0,
          // 扫描后的 hook 可能直接创建 Page，没有来源记录；按当前目录补回
          // 声明规则，诊断信息与普通扫描来源保持一致
          rulePattern: original?.rulePattern ?? this.configuredRule({ root, ruleIndex }),
          // 按现有分包路径换算还原完整路由，确保校验与实际输出采用同一基准
          route: root === undefined
            ? effective.path
            : path.posix.join(root, normalizePath(path.relative(root, effective.path))),
        })
      }
    }
    const selected = selectPageSources(candidates)
    validateGeneratedRoutes(selected, this.withUniPlatform ? this.platform : undefined)
    const active = new Set(candidates.map(source => source.page))
    const representatives = new Set(selected.map(source => source.page))
    // 跳过的页面仍保留读取缓存，但不认领身份或路由
    for (const pages of [this.pages, ...this.subPages.values()]) {
      for (const [file, page] of pages) {
        if (active.has(page) && !representatives.has(page))
          pages.delete(file)
      }
    }
  }

  /**
   * 解析 pages 规则并设置页面类型
   * @param pages 页面路径映射
   * @param packageType 页面包类型（主包或分包）
   * @param overrides 自定义页面配置
   * @returns pages 规则
   */
  private async parsePages(pages: Map<string, Page>, packageType: 'main' | 'sub', overrides?: Pages): Promise<InternalPages> {
    // 先把所有页面读一遍：`skipped` 标记（definePage(null) 退出）只有
    // 读过文件之后才准确
    const allPages = Array.from(pages.values())
    await Promise.all(allPages.map(page => page.ensureLoaded()))

    const jobs = allPages.filter(page => !page.skipped).map(page => page.getPageMeta())
    const generatedPageMetaData = await Promise.all(jobs)
    const customPageMetaData = (overrides || []) as InternalPages

    const result = customPageMetaData.length
      ? mergePageMetaDataArray(generatedPageMetaData.concat(customPageMetaData))
      : generatedPageMetaData

    const parseMeta = dedupeByPath(result)

    return packageType === 'main' ? this.setHomePage(parseMeta) : parseMeta
  }

  /**
   * 设置首页
   * @param result pages 规则数组
   * @returns pages 规则
   */
  private setHomePage(result: InternalPages): InternalPages {
    const hasHome = result.some(({ type }) => type === 'home')
    if (!hasHome) {
      // 把 homePage 配置换算成和页面路径一致的相对路径格式（相对 basePath）
      const basePath = this.basePath
      const resolvedHomePages = this.options.homePage.map((v) => {
        return normalizePath(path.relative(basePath, normalizePath(path.resolve(basePath, v))))
      })

      // 先按路径精确匹配；匹配不到再退回到"路径以 /配置值 结尾"的
      // 后缀匹配，处理页面目录不在 outDir 里的情况（如测试环境）
      const matchHomePage = (itemPath: string, configPath: string): boolean => {
        if (itemPath === configPath)
          return true
        const normalizedItem = itemPath.replace(/\\/g, '/')
        const normalizedConfig = configPath.replace(/\\/g, '/')
        return normalizedItem.endsWith(`/${normalizedConfig}`)
      }

      const isFoundHome = result.some((item) => {
        const isFound = resolvedHomePages.some(expectedPath => matchHomePage(item.path, expectedPath))
        if (isFound)
          item.type = 'home'

        return isFound
      })

      if (!isFoundHome) {
        this.logger?.warn('No home page found, check the configuration of pages.config.ts, or add the `homePage` option to UniPages in the Vite config file, or add `definePage({ type: "home" })` in your vue page.', {
          timestamp: true,
        })
      }
    }

    result.sort(page => (page.type === 'home' ? -1 : 0))

    return result
  }

  /**
   * 决议扫描来源后合并主包页面配置
   *
   * @description 有效分包优先认领物理页面，生成来源冲突在用户配置覆盖前检查
   */
  private async mergePageMetaData(): Promise<void> {
    await this.resolveScanSources()

    const pageMetaData = await this.parsePages(this.pages, 'main', this.pagesGlobConfig?.pages)

    this.pageMetaData = pageMetaData
    debug.pages(this.pageMetaData)
  }

  /**
   * 合并分包页面配置
   *
   * @description 静态、glob 和回调来源先按最终 root 汇集，再对整组应用一次配置覆盖，
   * 保留手工页面和分包 plugins 配置
   */
  private async mergeSubPageMetaData(): Promise<void> {
    const packagesByRoot = new Map<string, SubPackage>()
    const subPackages = this.pagesGlobConfig?.subPackages || []
    const pagesByRoot = new Map<string, Map<string, Page>>()
    for (const [dir, pages] of this.subPages) {
      const root = this.subPackageRoot(dir)
      const collected = pagesByRoot.get(root) ?? new Map<string, Page>()
      for (const [file, page] of pages)
        collected.set(file, page)
      pagesByRoot.set(root, collected)
    }

    for (const [root, pages] of pagesByRoot) {
      const globPackage = subPackages?.find(v => v.root === root)
      // 用户配置里的分包页面路径按 pages.json 的惯例相对 root 书写
      // （如 root 为 'pkg' 时写 'detail'）。合并前先换算成和扫描结果
      // 一样的基准（相对 outDir），两边路径才能对上号，合并后也才能
      // 统一转回相对 root 的形式；不做这一步，用户路径会被当成相对
      // root 已换算过的路径再换算一次，得到 '../detail' 这样的坏路径。
      // 已经带 root 前缀的写法（旧版容许的格式）保持原样，重复拼接
      // 会把路径弄坏
      const overrides = globPackage?.pages?.map((page) => {
        if (!page.path || page.path.startsWith(`${root}/`))
          return page
        return { ...page, path: `${root}/${page.path}` }
      })
      // 页面 path 是「文件相对 outDir 的位置」减去 root 的结果。root 与
      // 物理位置无关、或目录在 Vite root 之外时会保留一段 '..'：
      // uni-app 用 join(root, path) 定位源文件，去掉这段反而指向不存在的
      // 页面。root 本身保持干净，才是这个选项要解决的问题
      const parsedPages = (await this.parsePages(pages, 'sub', overrides))
        .map(page => ({ ...page, path: normalizePath(path.relative(root, page.path)) }))
      packagesByRoot.set(root, {
        root,
        pages: parsedPages,
        // 为该分包保留用户配置中的 plugins 配置
        ...(globPackage?.plugins && { plugins: globPackage.plugins }),
      })
    }

    // 用户在配置里写了分包、但这次扫描没有扫到对应目录时，原样带上
    for (const { root, pages, plugins } of subPackages) {
      if (root && !packagesByRoot.has(root)) {
        packagesByRoot.set(root, {
          root,
          pages: pages || [],
          ...(plugins && { plugins }),
        })
      }
    }

    this.subPageMetaData = [...packagesByRoot.values()].filter(meta => meta.pages.length > 0)
    debug.subPages(this.subPageMetaData)
  }
}

/**
 * 解析 pages.json 中页面路径的基准路径
 * @param options - 解析后的配置项
 * @returns 由 root 与 outDir 拼接并斜杠化后的基准路径
 */
function resolveBasePath(options: ResolvedOptions): string {
  return normalizePath(path.join(options.root, options.outDir))
}

/**
 * 获取指定目录下的全部页面路径
 * @param dir - 页面目录路径
 * @param options - 解析后的配置项
 * @returns 包含相对路径与绝对路径的页面路径数组
 */
function getPagePaths(dir: string, options: ResolvedOptions, basePath: string): PagePath[] {
  const pagesDirPath = normalizePath(path.resolve(options.root, dir))
  const files = getPageFiles(pagesDirPath, options)
  debug.pages(dir, files)
  const pagePaths = files
    .map(file => normalizePath(file))
    .map(file => ({
      relativePath: path.relative(basePath, normalizePath(path.resolve(pagesDirPath, file))),
      absolutePath: normalizePath(path.resolve(pagesDirPath, file)),
    }))

  return pagePaths
}

/**
 * 按路径去重页面配置，每个路径保留最后一条
 * @param pageMetaData - 页面配置数组
 * @returns 按首次出现顺序去重后的页面配置数组
 */
function dedupeByPath<T extends { path: string }>(pageMetaData: T[]): T[] {
  const byPath = new Map<string, T>()
  for (const page of pageMetaData)
    byPath.set(page.path, page)

  return [...byPath.values()]
}

/**
 * 应用 vite-plugin-uni-platform 的页面文件名后缀规则（如 `index.h5.vue`
 * 对应页面 `index`）：丢弃其他平台的后缀页面，保留当前平台的并把文件名
 * 里的后缀剥掉。
 *
 * 带点的判断只看路径最后一段（文件名），和 vite-plugin-uni-platform
 * 自己的规则一致（它也只在文件名上判断后缀），目录名里的点（如
 * `pages/v1.2/detail`）不算平台后缀。
 *
 * 注意后缀匹配仍是原始的 `path.includes(platform)`，没有做 definePage
 * 那边 h5/web 的别名换算（见 condition.ts 的 platformMatches）：
 * UNI_PLATFORM=web 时，`.h5` 后缀的页面会被过滤掉。这是一直以来的
 * 行为，为了和 vite-plugin-uni-platform 自己的命名规则保持一致而保留。
 *
 * @param pages - 合并后的主包页面配置
 * @param platform - 当前平台标识
 * @returns 过滤并剥掉后缀的新数组，入参不被修改
 */
export function filterPlatformSuffixPages(pages: InternalPages, platform: string): InternalPages {
  return pages
    .filter((page) => {
      const fileName = page.path.slice(page.path.lastIndexOf('/') + 1)
      return !fileName.includes('.') || page.path.includes(platform)
    })
    .map((page) => {
      const slash = page.path.lastIndexOf('/')
      const fileName = page.path.slice(slash + 1)
      const dot = fileName.indexOf('.')
      return dot === -1 ? page : { ...page, path: `${page.path.slice(0, slash + 1)}${fileName.slice(0, dot)}` }
    })
}

/**
 * 按路径合并页面信息并赋 style
 * @param pageMetaData 页面信息数组
 * TODO: 支持 middleware 合并
 */
function mergePageMetaDataArray(pageMetaData: InternalPages): InternalPages {
  const pageMetaDataObj = groupBy(pageMetaData, 'path')
  const result: InternalPages = []
  for (const path in pageMetaDataObj) {
    const group = pageMetaDataObj[path]
    const mergedPage = { ...group[0] }
    for (const page of group) {
      // 条目自己没有 style 键时，把 style 累积进来；条目自带 style
      // 时，下面的 Object.assign 会整体覆盖累积结果，这和旧版的原地
      // 实现一致。有两处检查故意和旧实现不同：合并目标永远是全新
      // 对象（旧代码会改动 Page 缓存共享的 style 对象，把脏键带到
      // 下一次运行），判断看键是否存在（Object.hasOwn），不看值真不真；继承来的
      // style 键不算条目自己的，Object.assign 也从不拷贝继承键。
      // 实践中 style 值都是普通对象（JSON 解析 / 对象字面量）
      if (!Object.hasOwn(page, 'style'))
        mergedPage.style = Object.assign({ ...(mergedPage.style ?? {}) }, page.style ?? {})
      Object.assign(mergedPage, page)
    }
    result.push(mergedPage)
  }
  return result
}

/**
 * 使虚拟模块失效以触发 HMR 更新
 * 页面配置变化时，需要使虚拟模块失效以重新生成内容
 *
 * @param server - Vite 开发服务器实例
 */
function invalidatePagesModule(server: ViteDevServer): void {
  const { moduleGraph } = server
  const mods = moduleGraph.getModulesByFile(RESOLVED_MODULE_ID_VIRTUAL)
  if (mods) {
    const seen = new Set<ModuleNode>()
    mods.forEach((mod) => {
      moduleGraph.invalidateModule(mod, seen)
    })
  }
}
