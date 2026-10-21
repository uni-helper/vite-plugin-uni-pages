import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar, TabBarItem } from '@uni-helper/uni-pages-types'
import type { FSWatcher } from 'chokidar'
import type { Logger, ModuleNode, ViteDevServer } from 'vite'
import type { SubPackageDirectorySource } from './directories'
import type { PageCandidate, PageSource } from './page-sources'
import type { InternalPages, PagePath, ResolvedOptions, UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { platform as uniEnvPlatform } from '@uni-helper/uni-env'
import { stringify as cjStringify } from 'comment-json'
import dbg from 'debug'
import groupBy from 'lodash.groupby'
import { normalizePath } from 'vite'
import { configFileExtensions, configWatchDirectory, isConfigLoaderArtifact, normalizeConfigPath, PagesConfigLoader } from './config-loader'
import { RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import { writeDeclaration } from './declaration'
import { getSubPackageDirectorySources, isPageDirectoryEvent, isPageFileInDirectories, refreshPageDirectories, resolvePageWatchDirectories } from './directories'
import { checkPagesJsonFileSync, getPageFiles, isTargetFile, resolvePagesJsonPath } from './files'
import { debug } from './logger'
import { resolveOptions } from './options'
import { Page } from './page'
import { comparePageSources, resolvePageIdentity, selectPageSources, validateGeneratedRoutes } from './page-sources'
import { writePagesJson } from './pages-json'

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
  private readonly watchedPageDirectories = new Map<FSWatcher, Set<string>>()
  /**
   * 每次事件都要比对的绝对路径，按 watcher 缓存
   *
   * 配置装载完成前为空，那时还没有依赖可比；装载后会刷新，
   * 回调里不再逐个调 realpathSync
   */
  private readonly watchedConfigIndex = new Map<FSWatcher, { files: Set<string>, directories: string[] }>()
  /** 生成物（pages.json、d.ts）的绝对路径，只在首次事件时算一次 */
  private generatedPathsCache: string[] | undefined
  private pendingUpdate: Promise<void> = Promise.resolve()
  /** 随扫描更新的 Page 来源，用于复用检查和冲突诊断 */
  private readonly pageSources = new WeakMap<Page, PageSource>()

  /** 失败恢复以此为基准，避免混入前几轮失败的临时路径 */
  private lastSuccessfulConfigDependencyPaths: string[] = []

  /** 当前配置本地依赖及加载失败后仍需监听的恢复路径 */
  pagesConfigDependencyPaths: string[] = []

  /** 装载失败时具体缺哪个文件；命中时不看兜底目录 */
  private configRecoveryCandidates: string[] = []

  /** 目录导入的恢复范围；只在装载失败时非空 */
  private configRecoveryDirectories: string[] = []

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
  /** 子包页面配置数组，用于生成 pages.json 的 subPackages 字段 */
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
    return resolveBasePath(this.options)
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
    this.platform = platform
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
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
   * 加载用户页面配置文件（如 pages.config.ts）
   * 使用 unconfig 加载配置，支持多种配置文件格式
   */
  async loadUserPagesConfig(): Promise<void> {
    try {
      const { config, sources, dependencies } = await this.configLoader.load(this.options.configSource)
      this.pagesGlobConfig = config.default || config
      this.pagesConfigSourcePaths = sources
      this.pagesConfigDependencyPaths = dependencies
      this.lastSuccessfulConfigDependencyPaths = [...dependencies]
      this.configRecoveryCandidates = []
      this.configRecoveryDirectories = []
      debug.options(this.pagesGlobConfig)
    }
    catch (error) {
      // 保留上次成功的依赖，只补入本轮失败的恢复路径
      this.configRecoveryCandidates = [...this.configLoader.recoveryCandidates]
      this.configRecoveryDirectories = [...this.configLoader.recoveryDirectories]
      this.pagesConfigDependencyPaths = [...new Set([...this.lastSuccessfulConfigDependencyPaths, ...this.configLoader.recoveryPaths])]
      throw error
    }
    finally {
      this.refreshConfigWatchers()
    }
  }

  /**
   * 按顺序跑完扫描与合并：先扫描主包和子包的页面，再合并它们的
   * 信息。步骤顺序只维护在这里，调用方和测试都不用关心。
   */
  async scanAndMerge(): Promise<void> {
    refreshPageDirectories(this.options)
    this.refreshPageWatchers()
    await this.scanPages()
    await this.scanSubPages()
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
  }

  /**
   * 设置 Vite 开发服务器，用于 HMR 与文件监听
   * @param server - Vite 开发服务器实例
   */
  setupViteServer(server: ViteDevServer): void {
    if (this._server === server)
      return

    this._server = server
    // Vite 5 内部使用 chokidar v3；其 watcher 在运行时与 chokidar v5 的 API 兼容
    this.setupWatcher(server.watcher as unknown as FSWatcher)
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

  /**
   * 设置文件监听器，监听页面文件与配置文件变更
   * 页面文件或配置文件变化时自动更新 pages.json
   * @param watcher - chokidar 文件监听器实例
   */
  async setupWatcher(watcher: FSWatcher): Promise<void> {
    if (this.watchers.has(watcher))
      return

    const handleEvent = (event: 'add' | 'change' | 'unlink', filepath: string): void => {
      const index = this.watchedConfigIndex.get(watcher)
      const basename = path.basename(filepath)
      const mightBeConfig = configFileExtensions.test(basename)
        && !isConfigLoaderArtifact(basename)

      const eventPath = normalizePath(path.resolve(this.root, normalizePath(filepath)))
      const excluded = this.generatedFilePaths()
      // 自己写的生成物不参与任何匹配，先走这步，免得为每个
      // pages.json 事件白做一次路径解析
      if (!isTargetFile(filepath) && excluded.includes(eventPath))
        return

      // 未直接命中的路径仍需解析，以识别符号链接别名；直接命中就不查文件系统
      const knownConfig = !!index?.files.has(eventPath) && !excluded.includes(eventPath)
      const absolute = knownConfig ? eventPath : normalizeConfigPath(filepath, this.root)

      // 已知配置不限扩展名，文件类型过滤只用于目录恢复
      const isConfigPath = !!index && (
        index.files.has(absolute)
        || (mightBeConfig && index.directories.some(dir => absolute.startsWith(`${dir}/`)))
      )
      const configChanged = !excluded.includes(absolute) && isConfigPath
      // 规则的编译结果按声明（dir/subPackages/exclude）缓存，glob 展开的
      // 目录和 root 回调仍在每轮扫描重算，所以新出现的目录不会漏掉
      const pageChanged = isTargetFile(filepath) && queryPageRules(false, () => isPageFileInDirectories(filepath, this.options))
      if (!configChanged && !pageChanged)
        return

      debug.pages(configChanged ? `Config changed: ${absolute}` : `File changed: ${absolute}`)
      void this.updatePagesAndNotify(!configChanged && event === 'change' ? filepath : undefined)
    }
    const onAdd = (file: string): void => handleEvent('add', file)
    const onChange = (file: string): void => handleEvent('change', file)
    const onUnlink = (file: string): void => handleEvent('unlink', file)
    // glob 规则下的目录增删会改变扫描目录集合（如新增 pkg-a 命中 src/pkg-*）
    const onDirectory = (directory: string): void => {
      if (queryPageRules(false, () => isPageDirectoryEvent(directory, this.options)))
        void this.updatePagesAndNotify()
    }
    // 初始扫描期间新增的路径可能被 ignoreInitial 吞掉，ready 后再收敛一次
    const onReady = (): void => void this.updatePagesAndNotify()
    watcher.on('add', onAdd)
    watcher.on('change', onChange)
    watcher.on('unlink', onUnlink)
    watcher.on('addDir', onDirectory)
    watcher.on('unlinkDir', onDirectory)
    watcher.on('ready', onReady)
    this.watchers.set(watcher, () => {
      watcher.off('add', onAdd)
      watcher.off('change', onChange)
      watcher.off('unlink', onUnlink)
      watcher.off('addDir', onDirectory)
      watcher.off('unlinkDir', onDirectory)
      watcher.off('ready', onReady)
    })
    this.watchedConfigPaths.set(watcher, new Set())
    this.watchedConfigIndex.set(watcher, { files: new Set(), directories: [] })
    this.watchedPageDirectories.set(watcher, new Set())
    this.refreshConfigWatchers()
    this.refreshPageWatchers()
  }

  /** 解绑本插件回调；共享 watcher 的关闭仍由 Vite 负责 */
  async disposeWatchers(): Promise<void> {
    for (const dispose of this.watchers.values())
      dispose()
    this.watchers.clear()
    this.watchedConfigPaths.clear()
    this.watchedConfigIndex.clear()
    this.watchedPageDirectories.clear()
    this._server = undefined
    await this.pendingUpdate
  }

  /** 补充未覆盖的监听路径，注册成功后记账，失败时保留重试机会 */
  private addWatchPaths(watcher: FSWatcher, paths: readonly string[], added: Set<string>, sharedRoot: string | undefined, description: string): void {
    const wanted = paths.filter(file => (!sharedRoot || (file !== sharedRoot && !file.startsWith(`${sharedRoot}/`)))
      && ![...added].some(existing => file === existing || file.startsWith(`${existing}/`)))
    if (!wanted.length)
      return
    try {
      // add() 返回 watcher，注册异步完成；这里只能捕获同步异常
      watcher.add(wanted)
      for (const file of wanted)
        added.add(file)
    }
    catch (error) {
      this.logger?.error(`[vite-plugin-uni-pages] Failed to watch ${description}: ${error instanceof Error ? error.message : error}`, { timestamp: true, error: error instanceof Error ? error : undefined })
    }
  }

  /** 补扫后补齐新生效的页面监听根；保留旧订阅以免影响共享 watcher */
  private refreshPageWatchers(): void {
    if (!this.watchers.size)
      return
    const directories = resolvePageWatchDirectories(this.options)
    for (const watcher of this.watchers.keys()) {
      const added = this.watchedPageDirectories.get(watcher)!
      const serverRoot = (this._server?.watcher as unknown) === watcher ? normalizePath(this._server!.config.root) : undefined
      this.addWatchPaths(watcher, directories, added, serverRoot, 'page directories')
    }
  }

  /**
   * 让监听路径与当前配置依赖保持一致
   *
   * 只新增路径，从不 unwatch：chokidar 对文件调用 unwatch 会连带
   * 拆掉父目录监听，新建文件就再也发现不了。因此监听集合是并集，
   * 会随着会话累积；每次刷新都按当前依赖重建 `watchedConfigIndex`，
   * 真正决定是否触发的始终是当前依赖集合（恢复目录除外，那是
   * 故意留的兜底）。
   */
  private refreshConfigWatchers(): void {
    // 配置加载的临时产物不能进监听集合：它们写完就删，Windows 上
    // chokidar 对消失了的目标调 fs.watch 会抛 EPERM
    const files = [...this.pagesConfigSourcePaths, ...this.pagesConfigDependencyPaths, ...this.configRecoveryCandidates]
      .filter(file => !isConfigLoaderArtifact(path.basename(file)))
    // 监听现存父目录可发现新建文件；事件仍按当前依赖集合过滤
    const paths = [...new Set([
      ...files,
      ...files.map(configWatchDirectory),
      ...this.configRecoveryDirectories.map(dir => configWatchDirectory(path.join(dir, '_'))),
    ])]
    // 父目录（尤其是项目 root）会覆盖其下所有路径，过滤事件时只看真实依赖，
    // 否则 root 会把任何路径都当成需要保留的
    const index = {
      files: new Set(files.map(file => normalizeConfigPath(file, this.root))),
      directories: this.configRecoveryDirectories.map(dir => normalizeConfigPath(dir, this.root)),
    }
    for (const watcher of this.watchers.keys()) {
      const added = this.watchedConfigPaths.get(watcher)!
      const sharedRoot = this._server && watcher === (this._server.watcher as unknown as FSWatcher)
        ? normalizeConfigPath(this._server.config.root, this.root)
        : undefined
      // sharedRoot 由 Vite 自己监听，不重复添加也不能撤销
      this.addWatchPaths(watcher, paths, added, sharedRoot, 'pages config dependencies')
      this.watchedConfigIndex.set(watcher, index)
    }
  }

  /**
   * 监听事件里的“更新并通知”：失败只记录，不让 Promise 拒绝。
   *
   * watcher 的回调走这里而不是直接调 {@link updatePagesJSON}：一旦
   * 它拒绝（拿不到文件锁、声明文件写不进去），就成了未处理的拒绝，
   * Node 默认直接终止进程——开发时正在编辑文件，一次偶发的锁冲突
   * 不该把 dev server 打死。用户改一次文件就会再触发一次事件，
   * 所以这里报错即可。
   *
   * @param filepath - 发生变更的文件路径，透传给 {@link updatePagesJSON}
   */
  private async updatePagesAndNotify(filepath?: string): Promise<void> {
    try {
      if (await this.updatePagesJSON(filepath))
        this.onUpdate()
    }
    catch (error) {
      this.logger?.error(`[vite-plugin-uni-pages] Failed to update pages.json after a file change: ${error instanceof Error ? error.message : error}`, { timestamp: true, error: error instanceof Error ? error : undefined })
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
   * 更新 pages.json 文件
   * 这是负责协调整个页面配置生成流程的核心方法：
   * 1. 检查文件变更（指定 filepath 时）
   * 2. 加载用户配置
   * 3. 扫描页面文件
   * 4. 合并页面配置
   * 5. 生成并写入 pages.json
   * @param filepath - 发生变更的文件路径，用于增量更新判断
   * @returns pages.json 是否成功更新
   */
  async updatePagesJSON(filepath?: string): Promise<boolean> {
    const update = this.pendingUpdate.then(() => this.generatePagesJSON(filepath))
    this.pendingUpdate = update.then(() => {}, () => {})
    return update
  }

  private async generatePagesJSON(filepath?: string): Promise<boolean> {
    if (filepath) {
      const page = this.findPage(filepath)
      if (page) {
        await page.read()
        if (!page.hasChanged()) {
          debug.cache(`The page meta on page ${filepath} did not send any changes, skipping`)
          return false
        }
      }
    }

    checkPagesJsonFileSync(this.resolvedPagesJSONPath)
    this.options.onBeforeLoadUserConfig()
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this.pagesGlobConfig)

    if (this.options.mergePages) {
      refreshPageDirectories(this.options)
      this.refreshPageWatchers()
      this.options.onBeforeScanPages()
      await this.scanPages(!filepath)
      await this.scanSubPages(!filepath)
      this.options.onAfterScanPages(this.pages, this.subPages)
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

    return result.updated
  }

  /**
   * 生成虚拟模块内容
   * 返回包含 pages 与 subPackages 导出的 JavaScript 代码
   * @returns 虚拟模块代码字符串
   */
  virtualModule(): string {
    const pages = `export const pages = ${this.resolveRoutes()};`
    const subPackages = `export const subPackages = ${this.resolveSubRoutes()};`
    return [pages, subPackages].join('\n')
  }

  /**
   * 将主包路由数据解析为 JSON 字符串
   * @returns 主包页面配置的 JSON 字符串
   */
  resolveRoutes(): string {
    return cjStringify(this.pageMetaData, null, 2)
  }

  /**
   * 将子包路由数据解析为 JSON 字符串
   * @returns 子包页面配置的 JSON 字符串
   */
  resolveSubRoutes(): string {
    return cjStringify(this.subPageMetaData, null, 2)
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
    return writeDeclaration({
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
      tabBar: this.tabBar,
      globConfig: this.pagesGlobConfig,
    }, this.options.dts)
  }

  /**
   * 按词法目录扫描主包页面
   *
   * @description 各目录分别执行文件排除，物理别名保留到页面有效性与归属决议阶段
   */
  private async scanPages(refreshContent = true): Promise<void> {
    const pages = new Map<string, Page>()
    for (const [matchIndex, dir] of this.options.dirs.entries()) {
      for (const pagePath of getPagePaths(dir, this.options)) {
        if (pages.has(pagePath.absolutePath))
          continue
        const page = this.trackPage(pagePath, this.pages.get(pagePath.absolutePath), {
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
    this.pages = pages
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
      : new Page(this, pagePath)
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
    })
    return page
  }

  /**
   * 按页面文件绝对路径查找被跟踪的页面（主包或任一子包）
   * @param filepath - 页面文件的绝对路径
   * @returns 被跟踪的页面，文件未被跟踪时为 undefined
   */
  private findPage(filepath: string): Page | undefined {
    const mainPage = this.pages.get(filepath)
    if (mainPage)
      return mainPage

    for (const pages of this.subPages.values()) {
      const subPage = pages.get(filepath)
      if (subPage)
        return subPage
    }

    const normalized = normalizeConfigPath(filepath, this.root)
    for (const pages of [this.pages, ...this.subPages.values()]) {
      for (const [file, page] of pages) {
        if (normalizeConfigPath(file, this.root) === normalized)
          return page
      }
    }
    return undefined
  }

  /**
   * 按词法来源扫描分包页面
   *
   * @description 同一物理目录的不同别名仍分别执行文件排除，避免某个别名被排除后漏页
   */
  private async scanSubPages(refreshContent = true): Promise<void> {
    const paths: Record<string, PagePath[]> = {}
    const subPages = new Map<string, Map<string, Page>>()
    const sources = this.subPackageSourcesByDir()
    for (const [dir, source] of sources) {
      const pagePaths = getPagePaths(dir, this.options)
      paths[dir] = pagePaths

      const pages = new Map<string, Page>()
      for (const pagePath of pagePaths) {
        const page = this.trackPage(pagePath, this.subPages.get(dir)?.get(pagePath.absolutePath), source, refreshContent)
        if (page)
          pages.set(pagePath.absolutePath, page)
      }
      subPages.set(dir, pages)
    }
    debug.subPages(JSON.stringify(paths, null, 2))

    this.subPages = subPages
  }

  /**
   * 为每个物理扫描目录选取声明来源
   *
   * @description 同一路径的不同写法只扫描一次，定位信息按显式优先选择；
   * 符号链接别名是不同的 absolute，仍分别保留各自的词法路径
   */
  private subPackageSourcesByDir(): Map<string, SubPackageDirectorySource> {
    const selected = new Map<string, SubPackageDirectorySource>()
    for (const source of getSubPackageDirectorySources(this.options)) {
      const previous = selected.get(source.absolute)
      if (!previous || comparePageSources(source, previous) < 0)
        selected.set(source.absolute, source)
    }
    return new Map([...selected.values()].map(source => [source.dir, source]))
  }

  /** 获取目录的最终分包 root，未登记时相对 outDir 计算默认值 */
  private subPackageRoot(dir: string): string {
    return this.options.subPackageRootMap.get(dir)
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
    const subSources = this.subPackageSourcesByDir()
    const groups: [string | undefined, Map<string, Page>][] = [[undefined, this.pages], ...this.subPages]
    // 宏可能异步求值，保持并行读取，来源决议仍按原顺序进行
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
        candidates.push({
          ...original,
          ...source,
          page,
          file,
          identity,
          dir: dir ?? original?.dir ?? this.options.dir,
          root,
          explicitRoot: source?.explicitRoot ?? original?.explicitRoot ?? false,
          ruleIndex: source?.ruleIndex ?? original?.ruleIndex ?? this.options.subPackages.indexOf(dir!),
          matchIndex: source?.matchIndex ?? original?.matchIndex ?? 0,
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
   * @param packageType 页面包类型（主包或子包）
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
   * 合并子包页面配置
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
      // 用户配置里的子包页面路径按 pages.json 的惯例相对 root 书写
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
      const parsedPages = (await this.parsePages(pages, 'sub', overrides))
        .map(page => ({ ...page, path: normalizePath(path.relative(root, page.path)) }))
      packagesByRoot.set(root, {
        root,
        pages: parsedPages,
        // 为该子包保留用户配置中的 plugins 配置
        ...(globPackage?.plugins && { plugins: globPackage.plugins }),
      })
    }

    // 用户在配置里写了子包、但这次扫描没有扫到对应目录时，原样带上
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
function getPagePaths(dir: string, options: ResolvedOptions): PagePath[] {
  const pagesDirPath = normalizePath(path.resolve(options.root, dir))
  const basePath = resolveBasePath(options)
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
      // 下一次运行），判断用 Object.hasOwn 而不是看值真不真——继承来的
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
