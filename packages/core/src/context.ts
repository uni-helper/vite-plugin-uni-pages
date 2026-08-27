import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar, TabBarItem } from '@uni-helper/uni-pages-types'
import type { FSWatcher } from 'chokidar'
import type { Logger, ModuleNode, ViteDevServer } from 'vite'
import type { InternalPages, PagePath, ResolvedOptions, UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { platform as uniEnvPlatform } from '@uni-helper/uni-env'
import { stringify as cjStringify } from 'comment-json'
import dbg from 'debug'
import groupBy from 'lodash.groupby'
import { loadConfig } from 'unconfig'
import { normalizePath } from 'vite'
import { RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import { writeDeclaration } from './declaration'
import { checkPagesJsonFileSync, getPageFiles, isTargetFile, resolvePagesJsonPath } from './files'
import { debug } from './logger'
import { resolveOptions } from './options'
import { Page } from './page'
import { writePagesJson } from './pages-json'

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

  /** 从用户配置文件（pages.config.ts）解析出的配置对象 */
  pagesGlobConfig: PagesConfig | undefined
  /** 用户配置文件的来源路径列表 */
  pagesConfigSourcePaths: string[] = []

  /** 主包页面映射，键为页面文件的绝对路径 */
  pages = new Map<string, Page>()
  /** 子包页面映射，键为子包根目录，值为该子包下的页面映射 */
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
    // 归一化斜杠：watcher 的事件回调里也归一化，两边比较才对得上
    // （Windows 上 unconfig 和 chokidar 报的斜杠方向可能不一致）
    this.pagesConfigSourcePaths = sources.map(normalizePath)
    debug.options(this.pagesGlobConfig)
  }

  /**
   * 按顺序跑完扫描与合并：先扫描主包和子包的页面，再合并它们的
   * 信息。步骤顺序只维护在这里，调用方和测试都不用关心。
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
    const targetDirs = [...this.options.dirs, ...this.options.subPackages].map(v => normalizePath(path.resolve(this.root, v)))
    // 前缀判断要吃到目录边界：'src/pages' 不能把隔壁的
    // 'src/pages-sub/…' 也认成自己的页面（Vite 的 watcher 默认盯整个
    // 项目，这种兄弟目录的变更事件是会进来的）
    const isWatchedPageFile = (filePath: string): boolean => {
      const absolute = normalizePath(path.resolve(this.root, filePath))
      return isTargetFile(filePath) && targetDirs.some(v => absolute === v || absolute.startsWith(`${v}/`))
    }

    watcher.on('add', async (path) => {
      path = normalizePath(path)
      if (!isWatchedPageFile(path))
        return

      debug.pages(`File added: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      path = normalizePath(path)
      // 配置文件按绝对路径监听；先判断它，配置的变更就不会被下面的
      // 页面文件判断漏掉。两边都归一化过斜杠（sources 在加载配置时、
      // 事件路径在上面），Windows 上斜杠方向不一致也不会错过配置变更。
      // 已知边界（权衡后接受）：sources 在启动时定死：启动时配置文件
      // 还不存在，loadConfig 返回的 sources 是空数组（已实测），
      // watcher.add 拿到空列表，之后再创建的配置文件永远不被监听，
      // 需要重启开发服务器才生效。
      if (this.pagesConfigSourcePaths.includes(path)) {
        debug.pages(`Config source changed: ${path}`)
        if (await this.updatePagesJSON())
          this.onUpdate()
        return
      }

      path = normalizePath(path)
      if (!isWatchedPageFile(path))
        return

      debug.pages(`File changed: ${path}`)
      if (await this.updatePagesJSON(path))
        this.onUpdate()
    })

    watcher.on('unlink', async (path) => {
      path = normalizePath(path)
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
   * 4. 合并页面配置
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

    // 声明文件写的是另一个文件（uni-pages.d.ts），不需要和 pages.json
    // 用同一把锁。保持原有行为：不管内容变没变，都在 pages.json 计算
    // 之后运行
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
   * 合并主包页面配置
   * 过滤掉属于子包的页面，再解析页面配置并与用户配置合并
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
   * 合并子包页面配置
   * 为每个子包解析页面配置并处理子包配置继承
   * 保留用户配置中子包级别的属性（如 plugins）
   */
  private async mergeSubPageMetaData(): Promise<void> {
    const packagesByRoot = new Map<string, SubPackage>()
    const subPackages = this.pagesGlobConfig?.subPackages || []

    for (const [dir, pages] of this.subPages) {
      // 优先用 subPackageRootMap 里的自定义 root，没有才按路径计算。
      // monorepo 场景下，自定义 root 可以避免 pages.json 里的 root
      // 出现 '..'
      const root = this.options.subPackageRootMap.get(dir)
        ?? normalizePath(path.relative(this.basePath, path.join(this.options.root, dir)))

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
