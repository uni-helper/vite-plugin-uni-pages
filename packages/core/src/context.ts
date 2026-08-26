import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar, TabBarItem } from '@uni-helper/uni-pages-types'
import type { FSWatcher } from 'chokidar'
import type { Logger, ModuleNode, ViteDevServer } from 'vite'
import type { InternalPages, PagePath, ResolvedOptions, UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { slash } from '@antfu/utils'
import { platform as uniEnvPlatform } from '@uni-helper/uni-env'
import { stringify as cjStringify } from 'comment-json'
import dbg from 'debug'
import groupBy from 'lodash.groupby'
import { loadConfig } from 'unconfig'
import { RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import { writeDeclaration } from './declaration'
import { checkPagesJsonFileSync, getPageFiles, isTargetFile, resolvePagesJsonPath } from './files'
import { debug } from './logger'
import { resolveOptions } from './options'
import { Page } from './page'
import { writePagesJson } from './pages-json'

/**
 * 页面上下文类，负责页面扫描、配置加载、页面元信息合并与 pages.json 生成
 *
 * 核心职责：
 * 1. 扫描页面目录并收集页面文件
 * 2. 加载用户配置文件（pages.config.ts 等）
 * 3. 解析页面元信息（definePage 宏）
 * 4. 合并页面配置并生成 pages.json
 * 5. 提供虚拟模块与 HMR 支持
 *
 * 流水线按固定顺序运行——加载用户配置、扫描、合并、写入——由
 * {@link updatePagesJSON}（完整运行）或 {@link scanAndMerge}（仅内存）
 * 编排。调用方无需了解阶段顺序。
 */
export class PageContext {
  private _server: ViteDevServer | undefined

  /** 从用户配置文件（pages.config.ts）解析出的配置对象 */
  pagesGlobConfig: PagesConfig | undefined
  /** 用户配置文件的来源路径列表 */
  pagesConfigSourcePaths: string[] = []

  /** 主包页面映射，键为页面文件的绝对路径 */
  pages = new Map<string, Page>()
  /** 子包页面映射，键为子包根目录，值为该子包下的页面映射 */
  subPages = new Map<string, Map<string, Page>>()
  /** 主包页面元信息数组，用于生成 pages.json 的 pages 字段 */
  pageMetaData: InternalPages = []
  /** 子包页面元信息数组，用于生成 pages.json 的 subPackages 字段 */
  subPageMetaData: SubPackages = []

  /** 生成的 pages.json 文件路径 */
  resolvedPagesJSONPath = ''

  /** 项目根目录 */
  root: string
  /** 解析后的配置项 */
  options: ResolvedOptions
  /** 当前平台标识，如 'mp-weixin'；注入式设计，调用方不绑定模块加载时冻结的环境 */
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
    this.root = slash(viteRoot)
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
    const configSource = this.options.configSource
    const { config, sources } = await loadConfig<PagesConfig>({ cwd: this.root, sources: configSource, defaults: {} })
    this.pagesGlobConfig = config.default || config
    this.pagesConfigSourcePaths = sources
    debug.options(this.pagesGlobConfig)
  }

  /**
   * 按顺序运行扫描与合并流水线：先扫描主包与子包页面，再合并它们的
   * 元信息。阶段顺序只维护在这里，调用方与测试无需了解。
   */
  async scanAndMerge(): Promise<void> {
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
   * 设置文件监听器，监听页面文件与配置文件变更
   * 页面文件或配置文件变化时自动更新 pages.json
   * @param watcher - chokidar 文件监听器实例
   */
  async setupWatcher(watcher: FSWatcher): Promise<void> {
    watcher.add(this.pagesConfigSourcePaths)
    const targetDirs = [...this.options.dirs, ...this.options.subPackages].map(v => slash(path.resolve(this.root, v)))
    const isWatchedPageFile = (filePath: string): boolean =>
      isTargetFile(filePath) && targetDirs.some(v => slash(path.resolve(this.root, filePath)).startsWith(v))

    watcher.on('add', async (path) => {
      path = slash(path)
      if (!isWatchedPageFile(path))
        return

      debug.pages(`File added: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      // 配置来源按绝对路径监听；先于页面文件检查处理，配置变更就不会
      // 被页面文件的判断漏掉
      if (this.pagesConfigSourcePaths.includes(path)) {
        debug.pages(`Config source changed: ${path}`)
        if (await this.updatePagesJSON())
          this.onUpdate()
        return
      }

      path = slash(path)
      if (!isWatchedPageFile(path))
        return

      debug.pages(`File changed: ${path}`)
      if (await this.updatePagesJSON(path))
        this.onUpdate()
    })

    watcher.on('unlink', async (path) => {
      path = slash(path)
      if (!isWatchedPageFile(path))
        return

      debug.pages(`File removed: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })
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
   * 4. 合并页面元信息
   * 5. 生成并写入 pages.json
   * @param filepath - 发生变更的文件路径，用于增量更新判断
   * @returns pages.json 是否成功更新
   */
  async updatePagesJSON(filepath?: string): Promise<boolean> {
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
      this.options.onBeforeScanPages()
      await this.scanPages()
      await this.scanSubPages()
      this.options.onAfterScanPages(this.pages, this.subPages)
    }

    this.options.onBeforeMergePageMetaData(this.pages, this.pagesGlobConfig)
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
    this.options.onAfterMergePageMetaData(this.pageMetaData, this.subPageMetaData)

    // vite-plugin-uni-platform 的页面后缀（如 `index.h5.vue` -> `index`）。
    // 注意后缀匹配是原始的 `path.includes(this.platform)`，不带
    // definePage DSL 中的 h5/web 别名归一（见 condition.ts 的
    // platformMatches）：UNI_PLATFORM=web 时 `.h5` 后缀的页面会被过滤
    // 掉。既有行为，为与 vite-plugin-uni-platform 自身的命名保持一致
    // 而保留。
    const pages = this.withUniPlatform
      ? this.pageMetaData.filter(v => !/\..*$/.test(v.path) || v.path.includes(this.platform)).map((v) => {
          v.path = v.path.replace(/\..*$/, '')
          return v
        })
      : this.pageMetaData

    this.pageMetaData = dedupeByPath(pages)

    this.options.onBeforeWriteFile(this.resolvedPagesJSONPath)

    // 从 pages.json 合并而来的条目可能缺少内部 `type` 标记（手写条目
    // 从不携带它），因此从扫描出的元信息中解析首页路径，交给
    // pages.json 模块用于位置调整
    const homePath = this.pageMetaData.find(meta => meta.type === 'home')?.path

    // 整个读-改-写运行在 pages.json 模块持有的同一把文件锁内，并发
    // 终端（如 dev:mp-weixin + dev:mp-alipay）因此不会破坏彼此的
    // 条件编译输出
    const result = await writePagesJson(this.resolvedPagesJSONPath, {
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
      tabBar: await this.resolveTabBar(),
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

    // 声明文件写的是另一个文件（uni-pages.d.ts），不需要在 pages.json
    // 的锁内。保持原有行为：无论内容是否变化，总在 pages.json 计算
    // 之后运行。
    this.generateDeclaration()

    if (result?.updated) {
      this.options.onAfterWriteFile(this.resolvedPagesJSONPath, result.content)
    }

    return result?.updated ?? false
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
   * @returns 主包页面元信息的 JSON 字符串
   */
  resolveRoutes(): string {
    return cjStringify(this.pageMetaData, null, 2)
  }

  /**
   * 将子包路由数据解析为 JSON 字符串
   * @returns 子包页面元信息的 JSON 字符串
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
    return writeDeclaration(this, this.options.dts)
  }

  /**
   * 扫描主包页面目录并收集所有页面文件路径
   * 根据配置的 dirs 选项扫描对应目录
   */
  private async scanPages(): Promise<void> {
    const paths = this.options.dirs.flatMap(dir => getPagePaths(dir, this.options))
    debug.pages(paths)

    const pages = new Map<string, Page>()
    for (const path of paths) {
      const page = this.pages.get(path.absolutePath) || new Page(this, path)
      pages.set(path.absolutePath, page)
    }

    this.pages = pages
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

    return undefined
  }

  /**
   * 扫描子包页面目录并收集所有子包页面文件路径
   * 根据配置的 subPackages 选项扫描对应目录
   */
  private async scanSubPages(): Promise<void> {
    const paths: Record<string, PagePath[]> = {}
    const subPages = new Map<string, Map<string, Page>>()
    for (const dir of this.options.subPackages) {
      const pagePaths = getPagePaths(dir, this.options)
      paths[dir] = pagePaths

      const pages = new Map<string, Page>()
      for (const path of pagePaths) {
        const page = this.subPages.get(dir)?.get(path.absolutePath) || new Page(this, path)
        pages.set(path.absolutePath, page)
      }
      subPages.set(dir, pages)
    }
    debug.subPages(JSON.stringify(paths, null, 2))

    this.subPages = subPages
  }

  /**
   * 解析 pages 规则并设置页面类型
   * @param pages 页面路径映射
   * @param packageType 页面包类型（主包或子包）
   * @param overrides 自定义页面配置
   * @returns pages 规则
   */
  private async parsePages(pages: Map<string, Page>, packageType: 'main' | 'sub', overrides?: Pages): Promise<InternalPages> {
    // 先加载所有页面：`skipped` 标记（definePage(null) 退出）只有在
    // 文件被读取后才准确
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
      // 将 homePage 配置解析为与页面路径一致的相对路径格式（相对 basePath）
      const basePath = this.basePath
      const resolvedHomePages = this.options.homePage.map((v) => {
        return slash(path.relative(basePath, slash(path.resolve(basePath, v))))
      })

      // 先按路径精确匹配，再退回到分段边界的后缀匹配，
      // 处理 dir 位于 outDir 之外的情况（如测试环境）
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
   * 合并主包页面元信息
   * 过滤掉属于子包的页面，再解析页面元信息并与用户配置合并
   */
  private async mergePageMetaData(): Promise<void> {
    // 丢弃属于子包的主包条目
    for (const pages of this.subPages.values()) {
      for (const subPageAbsolutePath of pages.keys())
        this.pages.delete(subPageAbsolutePath)
    }

    const pageMetaData = await this.parsePages(this.pages, 'main', this.pagesGlobConfig?.pages)

    this.pageMetaData = pageMetaData
    debug.pages(this.pageMetaData)
  }

  /**
   * 合并子包页面元信息
   * 为每个子包解析页面元信息并处理子包配置继承
   * 保留用户配置中子包级别的属性（如 plugins）
   */
  private async mergeSubPageMetaData(): Promise<void> {
    const packagesByRoot = new Map<string, SubPackage>()
    const subPackages = this.pagesGlobConfig?.subPackages || []

    for (const [dir, pages] of this.subPages) {
      // 优先使用 subPackageRootMap 中的自定义 root，否则按路径计算。
      // monorepo 场景下，自定义 root 可避免 pages.json 的 root 路径含 '..'
      const root = this.options.subPackageRootMap.get(dir)
        ?? slash(path.relative(this.basePath, path.join(this.options.root, dir)))

      const globPackage = subPackages?.find(v => v.root === root)
      const parsedPages = (await this.parsePages(pages, 'sub', globPackage?.pages))
        .map(page => ({ ...page, path: slash(path.relative(root, page.path)) }))
      packagesByRoot.set(root, {
        root,
        pages: parsedPages,
        // 为该子包保留用户配置中的 plugins 配置
        ...(globPackage?.plugins && { plugins: globPackage.plugins }),
      })
    }

    // 继承扫描页面中不存在的 subPackages 配置
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
  return slash(path.join(options.root, options.outDir))
}

/**
 * 获取指定目录下的全部页面路径
 * @param dir - 页面目录路径
 * @param options - 解析后的配置项
 * @returns 包含相对路径与绝对路径的页面路径数组
 */
function getPagePaths(dir: string, options: ResolvedOptions): PagePath[] {
  const pagesDirPath = slash(path.resolve(options.root, dir))
  const basePath = resolveBasePath(options)
  const files = getPageFiles(pagesDirPath, options)
  debug.pages(dir, files)
  const pagePaths = files
    .map(file => slash(file))
    .map(file => ({
      relativePath: path.relative(basePath, slash(path.resolve(pagesDirPath, file))),
      absolutePath: slash(path.resolve(pagesDirPath, file)),
    }))

  return pagePaths
}

/**
 * 按路径去重页面元信息，每个路径保留最后一条
 * @param pageMetaData - 页面元信息数组
 * @returns 按首次出现顺序去重后的页面元信息数组
 */
function dedupeByPath<T extends { path: string }>(pageMetaData: T[]): T[] {
  const byPath = new Map<string, T>()
  for (const page of pageMetaData)
    byPath.set(page.path, page)

  return [...byPath.values()]
}

/**
 * 按路径合并页面元信息数组并赋值 style
 * @param pageMetaData 页面元信息数组
 * TODO: 支持 middleware 合并
 */
function mergePageMetaDataArray(pageMetaData: InternalPages): InternalPages {
  const pageMetaDataObj = groupBy(pageMetaData, 'path')
  const result: InternalPages = []
  for (const path in pageMetaDataObj) {
    const group = pageMetaDataObj[path]
    const mergedPage = { ...group[0] }
    for (const page of group) {
      // 为没有自带 style 键的条目累积 style；自带 style 的条目通过下方
      // 的 Object.assign 整体替换累积结果，与之前的原地实现保持一致。
      // 有两处守卫有意与那个实现不同：目标始终是全新对象（旧代码会
      // 改动与 Page 缓存共享的 style 对象，导致跨运行的脏键泄漏），
      // 判断用 Object.hasOwn 而非真值——继承来的 style 键不算条目自身
      // 的，Object.assign 也从不拷贝继承键。实践中 style 值都是普通
      // 对象（JSON 解析 / 对象字面量）
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
