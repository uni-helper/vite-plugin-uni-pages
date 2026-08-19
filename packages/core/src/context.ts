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
 * Page context class responsible for page scanning, config loading, page metadata merging and pages.json generation
 *
 * Core responsibilities:
 * 1. Scan page directories and collect page files
 * 2. Load user configuration files (pages.config.ts, etc.)
 * 3. Parse page metadata (definePage macro)
 * 4. Merge page configurations and generate pages.json
 * 5. Provide virtual module and HMR support
 *
 * The pipeline runs in a fixed order — load user config, scan, merge, write —
 * orchestrated by {@link updatePagesJSON} (full run) or {@link scanAndMerge}
 * (in-memory only). Callers never need to know the stage order.
 */
export class PageContext {
  private _server: ViteDevServer | undefined

  /** Parsed configuration object from user config file (pages.config.ts) */
  pagesGlobConfig: PagesConfig | undefined
  /** Source path list of user configuration files */
  pagesConfigSourcePaths: string[] = []

  /** Main package page map, key is the absolute path of the page file */
  pages = new Map<string, Page>()
  /** Sub-package page map, key is the sub-package root directory, value is the page map under that sub-package */
  subPages = new Map<string, Map<string, Page>>()
  /** Main package page metadata array for generating pages.json pages field */
  pageMetaData: InternalPages = []
  /** Sub-package page metadata array for generating pages.json subPackages field */
  subPageMetaData: SubPackages = []

  /** Generated pages.json file path */
  resolvedPagesJSONPath = ''

  /** Project root directory */
  root: string
  /** Resolved configuration options */
  options: ResolvedOptions
  /** Current platform identifier, e.g. 'mp-weixin'; injected so callers are not bound to the env frozen at import time */
  readonly platform: string
  logger?: Logger

  /** Whether to work with vite-plugin-uni-platform plugin */
  withUniPlatform = false

  /** Cached previous pages.json content to avoid redundant writes */
  private lastPagesJson = ''

  /** Base path that page paths in pages.json are resolved relative to */
  private get basePath(): string {
    return resolveBasePath(this.options)
  }

  /**
   * Create a PageContext instance
   * @param userOptions - User configuration options
   * @param viteRoot - Vite project root directory, defaults to current working directory
   * @param platform - Current platform identifier, defaults to the uni-env platform
   */
  constructor(userOptions: UserOptions, viteRoot: string = process.cwd(), platform: string = uniEnvPlatform) {
    this.root = slash(viteRoot)
    this.platform = platform
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    // debug logic
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
   * Set the Vite logger
   * @param logger - Vite logger instance
   */
  setLogger(logger: Logger): void {
    this.logger = logger
  }

  /**
   * Load user page configuration file (e.g. pages.config.ts)
   * Uses unconfig to load configuration, supporting multiple config file formats
   */
  async loadUserPagesConfig(): Promise<void> {
    const configSource = this.options.configSource
    const { config, sources } = await loadConfig<PagesConfig>({ cwd: this.root, sources: configSource, defaults: {} })
    this.pagesGlobConfig = config.default || config
    this.pagesConfigSourcePaths = sources
    debug.options(this.pagesGlobConfig)
  }

  /**
   * Run the scan and merge pipeline in order: scan main and sub-package pages,
   * then merge their metadata. The stage order lives here so callers and tests
   * do not have to know it.
   */
  async scanAndMerge(): Promise<void> {
    await this.scanPages()
    await this.scanSubPages()
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
  }

  /**
   * Set up Vite dev server for HMR and file watching
   * @param server - Vite dev server instance
   */
  setupViteServer(server: ViteDevServer): void {
    if (this._server === server)
      return

    this._server = server
    // Vite 5 uses chokidar v3 internally; its watcher is API-compatible with chokidar v5 at runtime
    this.setupWatcher(server.watcher as unknown as FSWatcher)
  }

  /**
   * Set up file watcher to monitor page file and config file changes
   * Automatically update pages.json when page files or config files change
   * @param watcher - chokidar file watcher instance
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
      // Config sources are watched by absolute path; handle them before the
      // page-file checks so a config change is never dropped by them
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
   * Page update callback, triggered when page files or configuration changes
   * Responsible for invalidating virtual modules and notifying the browser to do a full reload
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
   * Update pages.json file
   * This is the core method responsible for coordinating the entire page configuration generation flow:
   * 1. Check file changes (if filepath is specified)
   * 2. Load user configuration
   * 3. Scan page files
   * 4. Merge page metadata
   * 5. Generate and write pages.json
   * @param filepath - Changed file path for incremental update judgment
   * @returns Whether pages.json was successfully updated
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
      ? this.pageMetaData.filter(v => !/\..*$/.test(v.path) || v.path.includes(this.platform)).map((v) => {
          v.path = v.path.replace(/\..*$/, '')
          return v
        })
      : this.pageMetaData

    this.pageMetaData = dedupeByPath(pages)

    this.options.onBeforeWriteFile(this.resolvedPagesJSONPath)

    // Entries merged from pages.json may lack the internal `type` marker
    // (user-written entries never carry it), so resolve the home page path
    // from the scanned metadata and hand it to the pages.json module for
    // repositioning
    const homePath = this.pageMetaData.find(meta => meta.type === 'home')?.path

    // The whole read-modify-write runs inside one file lock owned by the
    // pages.json module, so concurrent terminals (e.g. dev:mp-weixin +
    // dev:mp-alipay) cannot corrupt each other's conditional-compilation output
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
      // Getter: evaluated inside the lock so an overlapping update sees the
      // content this instance just wrote, matching the pre-refactor semantics
      previousContent: () => this.lastPagesJson,
    })

    // Declaration writes a different file (uni-pages.d.ts) and does not need to
    // be inside the pages.json lock. Mirror the original behaviour: always run
    // it after the pages.json computation, regardless of whether content changed.
    this.generateDeclaration()

    if (result?.updated) {
      this.lastPagesJson = result.content
      this.options.onAfterWriteFile(this.resolvedPagesJSONPath, result.content)
    }

    return result?.updated ?? false
  }

  /**
   * Generate virtual module content
   * Returns JavaScript code containing pages and subPackages exports
   * @returns Virtual module code string
   */
  virtualModule(): string {
    const pages = `export const pages = ${this.resolveRoutes()};`
    const subPackages = `export const subPackages = ${this.resolveSubRoutes()};`
    return [pages, subPackages].join('\n')
  }

  /**
   * Resolve main package route data to JSON string
   * @returns JSON string of main package page metadata
   */
  resolveRoutes(): string {
    return cjStringify(this.pageMetaData, null, 2)
  }

  /**
   * Resolve sub-package route data to JSON string
   * @returns JSON string of sub-package page metadata
   */
  resolveSubRoutes(): string {
    return cjStringify(this.subPageMetaData, null, 2)
  }

  /**
   * Resolve tabBar configuration
   * Merges page-defined tabBar items with config-defined tabBar
   * @returns Merged tabBar configuration object, or undefined if no tabBar exists
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
   * Generate TypeScript declaration file
   * Generate type definitions for page paths to provide type hints during navigation
   */
  generateDeclaration(): Promise<void> | undefined {
    if (!this.options.dts)
      return

    debug.declaration('generating')
    return writeDeclaration(this, this.options.dts)
  }

  /**
   * Scan main package page directories and collect all page file paths
   * Scan corresponding directories based on the configured dirs option
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
   * Find a tracked page (main package or any sub-package) by its absolute file path
   * @param filepath - Absolute path of the page file
   * @returns The tracked page, or undefined when the file is not tracked
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
   * Scan sub-package page directories and collect all sub-package page file paths
   * Scan corresponding directories based on the configured subPackages option
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
   * parse pages rules && set page type
   * @param pages page path array
   * @param packageType  page package type (main package or sub-package)
   * @param overrides custom page config
   * @returns pages rules
   */
  private async parsePages(pages: Map<string, Page>, packageType: 'main' | 'sub', overrides?: Pages): Promise<InternalPages> {
    // Load every page first: the `skipped` flag (definePage(null) opt-out) is
    // only accurate after the file has been read
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
   * set home page
   * @param result pages rules array
   * @returns pages rules
   */
  private setHomePage(result: InternalPages): InternalPages {
    const hasHome = result.some(({ type }) => type === 'home')
    if (!hasHome) {
      // Resolve homePage config to the same relative-path format as page paths (relative to basePath)
      const basePath = this.basePath
      const resolvedHomePages = this.options.homePage.map((v) => {
        return slash(path.relative(basePath, slash(path.resolve(basePath, v))))
      })

      // Match by exact path first, then fall back to segment-boundary suffix match
      // to handle cases where dir is outside outDir (e.g. test environments)
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
   * Merge main package page metadata
   * Filter out pages belonging to sub-packages, then parse page metadata and merge user configuration
   */
  private async mergePageMetaData(): Promise<void> {
    // Drop main-package entries that belong to sub-packages
    for (const pages of this.subPages.values()) {
      for (const subPageAbsolutePath of pages.keys())
        this.pages.delete(subPageAbsolutePath)
    }

    const pageMetaData = await this.parsePages(this.pages, 'main', this.pagesGlobConfig?.pages)

    this.pageMetaData = pageMetaData
    debug.pages(this.pageMetaData)
  }

  /**
   * Merge sub-package page metadata
   * Parse page metadata for each sub-package and handle sub-package configuration inheritance
   * Preserves sub-package level properties like plugins from user config
   */
  private async mergeSubPageMetaData(): Promise<void> {
    const packagesByRoot = new Map<string, SubPackage>()
    const subPackages = this.pagesGlobConfig?.subPackages || []

    for (const [dir, pages] of this.subPages) {
      // Use custom root from subPackageRootMap if available, otherwise calculate from path
      // In monorepo scenarios, custom root avoids '..' in pages.json root path
      const root = this.options.subPackageRootMap.get(dir)
        ?? slash(path.relative(this.basePath, path.join(this.options.root, dir)))

      const globPackage = subPackages?.find(v => v.root === root)
      const parsedPages = (await this.parsePages(pages, 'sub', globPackage?.pages))
        .map(page => ({ ...page, path: slash(path.relative(root, page.path)) }))
      packagesByRoot.set(root, {
        root,
        pages: parsedPages,
        // Preserve plugins config from user config for this sub-package
        ...(globPackage?.plugins && { plugins: globPackage.plugins }),
      })
    }

    // Inherit subPackages that do not exist in the scanned pages
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
 * Resolve the base path that page paths in pages.json are relative to
 * @param options - Resolved configuration options
 * @returns Slashed base path joined from root and outDir
 */
function resolveBasePath(options: ResolvedOptions): string {
  return slash(path.join(options.root, options.outDir))
}

/**
 * Get all page paths in the specified directory
 * @param dir - Page directory path
 * @param options - Resolved configuration options
 * @returns Page path array containing relative and absolute paths
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
 * Deduplicate page metadata by path, keeping the last entry for each path
 * @param pageMetaData - Page metadata array
 * @returns Deduplicated page metadata array in first-seen order
 */
function dedupeByPath<T extends { path: string }>(pageMetaData: T[]): T[] {
  const byPath = new Map<string, T>()
  for (const page of pageMetaData)
    byPath.set(page.path, page)

  return [...byPath.values()]
}

/**
 * merge page meta data array by path and assign style
 * @param pageMetaData  page meta data array
 * TODO: support merge middleware
 */
function mergePageMetaDataArray(pageMetaData: InternalPages): InternalPages {
  const pageMetaDataObj = groupBy(pageMetaData, 'path')
  const result: InternalPages = []
  for (const path in pageMetaDataObj) {
    const group = pageMetaDataObj[path]
    const mergedPage = { ...group[0] }
    for (const page of group) {
      // Accumulate style for entries without their own style key; an entry
      // carrying its own style replaces the accumulation outright via the
      // Object.assign below, mirroring the previous in-place implementation.
      // Two guards differ from that implementation on purpose: the target is
      // always a fresh object (the old code mutated style objects shared
      // with the Page cache, leaking stale keys across runs), and the check
      // is Object.hasOwn so inherited style keys don't count as the entry's
      // own — Object.assign never copies inherited keys either. Style
      // values are plain objects in practice (JSON parse / object literals)
      if (!Object.hasOwn(page, 'style'))
        mergedPage.style = Object.assign({ ...(mergedPage.style ?? {}) }, page.style ?? {})
      Object.assign(mergedPage, page)
    }
    result.push(mergedPage)
  }
  return result
}

/**
 * Invalidate virtual module to trigger HMR update
 * When page configuration changes, the virtual module needs to be invalidated to regenerate content
 *
 * @param server - Vite dev server instance
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
