import type { FSWatcher } from 'chokidar'
import type { CommentObject, CommentSymbol } from 'comment-json'
import type { Logger, ViteDevServer } from 'vite'
import type { PagesConfig, TabBar, TabBarItem } from './config'
import type { ExcludeIndexSignature, PageMetaDatum, PagePath, ResolvedOptions, SubPageMetaDatum, UserOptions } from './types'

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { slash } from '@antfu/utils'
import { platform } from '@uni-helper/uni-env'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import dbg from 'debug'
import detectIndent from 'detect-indent'

import detectNewline from 'detect-newline'
import { loadConfig } from 'unconfig'
import { OUTPUT_NAME } from './constant'
import { writeDeclaration } from './declaration'
import { checkPagesJsonFileSync, getPageFiles, writeFileWithLock } from './files'
import { resolveOptions } from './options'
import { Page } from './page'
import {
  debug,
  invalidatePagesModule,
  isTargetFile,
  mergePageMetaDataArray,
  stripType,
} from './utils'

/**
 * Page context class responsible for page scanning, config loading, page metadata merging and pages.json generation
 *
 * Core responsibilities:
 * 1. Scan page directories and collect page files
 * 2. Load user configuration files (pages.config.ts, etc.)
 * 3. Parse page metadata (definePage macro)
 * 4. Merge page configurations and generate pages.json
 * 5. Provide virtual module and HMR support
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
  pageMetaData: PageMetaDatum[] = []
  /** Sub-package page metadata array for generating pages.json subPackages field */
  subPageMetaData: SubPageMetaDatum[] = []

  /** Generated pages.json file path */
  resolvedPagesJSONPath = ''
  private resolvedPagesJSONIndent?: string // '  '
  private resolvedPagesJSONNewline?: string // '\n'
  private resolvedPagesJSONEofNewline?: boolean // true

  /** Original options passed by the user */
  rawOptions: UserOptions
  /** Project root directory */
  root: string
  /** Resolved configuration options */
  options: ResolvedOptions
  logger?: Logger

  /** Whether to work with vite-plugin-uni-platform plugin */
  withUniPlatform = false

  /** Cached previous pages.json content to avoid redundant writes */
  private lastPagesJson = ''

  /**
   * Create a PageContext instance
   * @param userOptions - User configuration options
   * @param viteRoot - Vite project root directory, defaults to current working directory
   */
  constructor(userOptions: UserOptions, viteRoot: string = process.cwd()) {
    this.rawOptions = userOptions
    this.root = slash(viteRoot)
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    // debug logic
    const debugOption = this.options.debug
    if (debugOption) {
      const prefix = 'vite-plugin-uni-pages:'
      const suffix = typeof debugOption === 'boolean' ? '*' : debugOption
      dbg.enable(`${prefix}${suffix}`)
    }
    this.resolvedPagesJSONPath = path.join(this.root, this.options.outDir, OUTPUT_NAME)
    debug.options(this.options)
  }

  /**
   * Set the Vite logger
   * @param logger - Vite logger instance
   */
  setLogger(logger: Logger) {
    this.logger = logger
  }

  /**
   * Load user page configuration file (e.g. pages.config.ts)
   * Uses unconfig to load configuration, supporting multiple config file formats
   */
  async loadUserPagesConfig() {
    const configSource = this.options.configSource
    const { config, sources } = await loadConfig<PagesConfig>({ cwd: this.root, sources: configSource, defaults: {} })
    this.pagesGlobConfig = config.default || config
    this.pagesConfigSourcePaths = sources
    debug.options(this.pagesGlobConfig)
  }

  /**
   * Scan main package page directories and collect all page file paths
   * Scan corresponding directories based on the configured dirs option
   */
  async scanPages() {
    const pageDirFiles = this.options.dirs.map((dir) => {
      return { dir, files: getPagePaths(dir, this.options) }
    })

    const paths = pageDirFiles.map(page => page.files).flat()
    debug.pages(paths)

    const pages = new Map<string, Page>()
    for (const path of paths) {
      const page = this.pages.get(path.absolutePath) || new Page(this, path)
      pages.set(path.absolutePath, page)
    }

    this.pages = pages
  }

  /**
   * Scan sub-package page directories and collect all sub-package page file paths
   * Scan corresponding directories based on the configured subPackages option
   */
  async scanSubPages() {
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
   * Set up Vite dev server for HMR and file watching
   * @param server - Vite dev server instance
   */
  setupViteServer(server: ViteDevServer) {
    if (this._server === server)
      return

    this._server = server
    this.setupWatcher(server.watcher)
  }

  /**
   * Set up file watcher to monitor page file and config file changes
   * Automatically update pages.json when page files or config files change
   * @param watcher - chokidar file watcher instance
   */
  async setupWatcher(watcher: FSWatcher) {
    watcher.add(this.pagesConfigSourcePaths)
    const targetDirs = [...this.options.dirs, ...this.options.subPackages].map(v => slash(path.resolve(this.root, v)))
    const isInTargetDirs = (filePath: string) => targetDirs.some(v => slash(path.resolve(this.root, filePath)).startsWith(v))

    watcher.on('add', async (path) => {
      path = slash(path)

      if (!isTargetFile(path))
        return

      if (!isInTargetDirs(path))
        return

      debug.pages(`File added: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return
      if (!isInTargetDirs(path))
        return

      debug.pages(`File changed: ${path}`)
      debug.pages(targetDirs)
      debug.pages(isInTargetDirs(path))
      if (await this.updatePagesJSON(path))
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      if (this.pagesConfigSourcePaths.includes(path)) {
        debug.pages(`Config source changed: ${path}`)
        if (await this.updatePagesJSON())
          this.onUpdate()
      }
    })

    watcher.on('unlink', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return

      if (!isInTargetDirs(path))
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
  onUpdate() {
    if (!this._server)
      return

    invalidatePagesModule(this._server)
    debug.hmr('Reload generated pages.')
    this._server.ws.send({
      type: 'full-reload',
    })
  }

  /**
   * parse pages rules && set page type
   * @param pages page path array
   * @param type  page type
   * @param overrides custom page config
   * @returns pages rules
   */
  async parsePages(pages: Map<string, Page>, type: 'main' | 'sub', overrides?: PageMetaDatum[]) {
    const jobs: Promise<PageMetaDatum>[] = []
    for (const [_, page] of pages) {
      jobs.push(page.getPageMeta())
    }
    const generatedPageMetaData = await Promise.all(jobs)
    const customPageMetaData = overrides || []

    const result = customPageMetaData.length
      ? mergePageMetaDataArray(generatedPageMetaData.concat(customPageMetaData))
      : generatedPageMetaData

    // Use Map for deduplication, keeping the last element for each path while maintaining good performance
    const parseMeta = Array.from(
      result.reduce((map, page) => {
        map.set(page.path, page)
        return map
      }, new Map<string, PageMetaDatum>()).values(),
    )

    return type === 'main' ? this.setHomePage(parseMeta) : parseMeta
  }

  /**
   * set home page
   * @param result pages rules array
   * @returns pages rules
   */
  setHomePage(result: PageMetaDatum[]): PageMetaDatum[] {
    const hasHome = result.some(({ type }) => type === 'home')
    if (!hasHome) {
      // Resolve homePage config to the same relative-path format as page paths (relative to basePath)
      const basePath = slash(path.join(this.options.root, this.options.outDir))
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
        this.logger?.warn('No home page found, check the configuration of pages.config.ts, or add the `homePage` option to UniPages in vite.config.js, or add `definePage({ type: "home" })` in your vue page.', {
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
  async mergePageMetaData() {
    // Collect all absolute paths of pages in sub-packages
    const subPageAbsolutePaths = Array.from(this.subPages.values()).flatMap(v => Array.from(v.keys()))

    // Filter out pages belonging to sub-packages
    for (const subPageAbsolutePath of subPageAbsolutePaths)
      this.pages.delete(subPageAbsolutePath)

    const pageMetaData = await this.parsePages(this.pages, 'main', this.pagesGlobConfig?.pages)

    this.pageMetaData = pageMetaData
    debug.pages(this.pageMetaData)
  }

  /**
   * Merge sub-package page metadata
   * Parse page metadata for each sub-package and handle sub-package configuration inheritance
   * Preserves sub-package level properties like plugins from user config
   */
  async mergeSubPageMetaData() {
    const subPageMaps: Record<string, PageMetaDatum[]> = {}
    // Store plugins config separately to preserve them during merge
    const subPlugins: Record<string, SubPageMetaDatum['plugins']> = {}
    const subPackages = this.pagesGlobConfig?.subPackages || []

    for (const [dir, pages] of this.subPages) {
      const basePath = slash(path.join(this.options.root, this.options.outDir))
      const root = slash(path.relative(basePath, path.join(this.options.root, dir)))

      const globPackage = subPackages?.find(v => v.root === root)
      subPageMaps[root] = await this.parsePages(pages, 'sub', globPackage?.pages)
      subPageMaps[root] = subPageMaps[root].map(page => ({ ...page, path: slash(path.relative(root, page.path)) }))
      // Preserve plugins config from user config for this sub-package
      if (globPackage?.plugins)
        subPlugins[root] = globPackage.plugins
    }

    // Inherit subPackages that do not exist in the scanned pages
    for (const { root, pages, plugins } of subPackages) {
      if (root && !subPageMaps[root]) {
        subPageMaps[root] = pages || []
        // Preserve plugins config for inherited sub-packages
        if (plugins)
          subPlugins[root] = plugins
      }
    }

    // Build final subPageMetaData with plugins preserved
    const subPageMetaData = Object.keys(subPageMaps)
      .map(root => ({
        root,
        pages: subPageMaps[root],
        ...(subPlugins[root] && { plugins: subPlugins[root] }),
      }))
      .filter(meta => meta.pages.length > 0)

    this.subPageMetaData = subPageMetaData
    debug.subPages(this.subPageMetaData)
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
  async updatePagesJSON(filepath?: string) {
    if (filepath) {
      let page = this.pages.get(filepath)
      if (!page) {
        let subPage: Page | undefined
        for (const [_, pages] of this.subPages) {
          subPage = pages.get(filepath)
          if (subPage) {
            break
          }
        }
        page = subPage
      }
      if (page) {
        await page.read()
        if (!page.hasChanged()) {
          debug.cache(`The page meta on page ${filepath} did not send any changes, skipping`)
          return false
        }
      }
    }

    checkPagesJsonFileSync(this.resolvedPagesJSONPath)
    this.options.onBeforeLoadUserConfig(this)
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this)

    if (this.options.mergePages) {
      this.options.onBeforeScanPages(this)
      await this.scanPages()
      await this.scanSubPages()
      this.options.onAfterScanPages(this)
    }

    this.options.onBeforeMergePageMetaData(this)
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
    this.options.onAfterMergePageMetaData(this)

    const pagesMap = new Map()
    const pages = this.withUniPlatform
      ? this.pageMetaData.filter(v => !/\..*$/.test(v.path) || v.path.includes(platform)).map((v) => {
          v.path = v.path.replace(/\..*$/, '')
          return v
        })
      : this.pageMetaData
    pages.forEach(v => pagesMap.set(v.path, v))
    this.pageMetaData = [...pagesMap.values()]

    this.options.onBeforeWriteFile(this)

    const data = await this.genratePagesJSON()

    const pagesJson = cjStringify(
      data,
      null,
      this.options.minify ? undefined : await this.getIndent(),
    ) + (
      await this.getEndOfLine() ? await this.getNewline() : ''
    )
    this.generateDeclaration()
    if (this.lastPagesJson === pagesJson) {
      debug.pages('PagesJson Not have change')
      return false
    }

    await writeFileWithLock(this.resolvedPagesJSONPath, pagesJson)

    this.lastPagesJson = pagesJson

    this.options.onAfterWriteFile(this)
    return true
  }

  /**
   * Generate virtual module content
   * Returns JavaScript code containing pages and subPackages exports
   * @returns Virtual module code string
   */
  virtualModule() {
    const pages = `export const pages = ${this.resolveRoutes()};`
    const subPackages = `export const subPackages = ${this.resolveSubRoutes()};`
    return [pages, subPackages].join('\n')
  }

  /**
   * Resolve main package route data to JSON string
   * @returns JSON string of main package page metadata
   */
  resolveRoutes() {
    const routes = this.pageMetaData.map(stripType)
    return cjStringify(routes, null, 2)
  }

  /**
   * Resolve sub-package route data to JSON string
   * @returns JSON string of sub-package page metadata
   */
  resolveSubRoutes() {
    const routes = this.subPageMetaData.map(({ pages, ...rest }) => ({
      ...rest,
      pages: pages.map(stripType),
    }))
    return cjStringify(routes, null, 2)
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

    const pagePaths = new Map<string, boolean>()
    for (const item of tabBar.list) {
      pagePaths.set(item.pagePath, true)
    }

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
  generateDeclaration() {
    if (!this.options.dts)
      return

    debug.declaration('generating')
    return writeDeclaration(this, this.options.dts)
  }

  private async genratePagesJSON() {
    const content = await fs.promises.readFile(this.resolvedPagesJSONPath, { encoding: 'utf-8' }).catch(() => '')

    const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = cjParse(content || '{}') as CommentObject

    const { pages: _pages, subPackages: _subPackages, tabBar: _tabBar, ...pageJson } = this.pagesGlobConfig || {}

    const currentPlatform = platform.toUpperCase()

    // pages
    pageJson.pages = mergePlatformItems(oldPages as any, currentPlatform, this.pageMetaData, 'path').map(stripType) as any

    // mergePlatformItems uses a Map internally which may lose the ordering from setHomePage,
    // so we need to ensure the home page is placed first after the merge
    if (pageJson.pages && pageJson.pages.length > 0) {
      const pagesArray = pageJson.pages as unknown as PageMetaDatum[]
      const homeIndex = pagesArray.findIndex((page: any) => page.type === 'home')
      if (homeIndex > 0) {
        const [homePage] = pagesArray.splice(homeIndex, 1)
        pagesArray.unshift(homePage)
      }
    }

    // subPackages
    pageJson.subPackages = oldSubPackages || new CommentArray<CommentObject>()
    const newSubPackages = new Map<string, SubPageMetaDatum>()
    for (const item of this.subPageMetaData) {
      newSubPackages.set(item.root, item)
    }
    // Update existing sub-packages in pages.json with new metadata
    for (const existing of pageJson.subPackages as unknown as SubPageMetaDatum[]) {
      const sub = newSubPackages.get(existing.root)
      if (sub) {
        existing.pages = mergePlatformItems(existing.pages, currentPlatform, sub.pages, 'path').map(stripType) as any
        // Preserve plugins property from user config
        if (sub.plugins) {
          existing.plugins = sub.plugins
        }
        newSubPackages.delete(existing.root)
      }
    }
    // Add new sub-packages that don't exist in pages.json yet
    for (const [_, newSub] of newSubPackages) {
      const subPackage: Record<string, any> = {
        root: newSub.root,
        pages: mergePlatformItems(undefined, currentPlatform, newSub.pages, 'path').map(stripType),
      }
      // Include plugins property if configured
      if (newSub.plugins) {
        subPackage.plugins = newSub.plugins
      }
      (pageJson.subPackages as unknown as Array<any>).push(subPackage)
    }

    // tabbar
    const { list, ...tabBarOthers } = (await this.resolveTabBar()) || {}
    if (list) {
      const { list: oldList } = (oldTabBar as any) || {}
      const newList = mergePlatformItems(oldList, currentPlatform, list, 'pagePath')
      pageJson.tabBar = {
        ...tabBarOthers, // Always update properties other than list directly
        list: newList,
      }
    }
    else {
      pageJson.tabBar = undefined // Clear directly, currently not supporting platform A having tabBar while platform B does not
    }

    return pageJson
  }

  private async readInfoFromPagesJSON(): Promise<void> {
    const resolvedPagesJSONContent = await fs.promises.readFile(this.resolvedPagesJSONPath, { encoding: 'utf-8' }).catch(() => '')
    this.resolvedPagesJSONIndent = detectIndent(resolvedPagesJSONContent).indent || '  '
    this.resolvedPagesJSONNewline = detectNewline(resolvedPagesJSONContent) || '\n'
    this.resolvedPagesJSONEofNewline = (resolvedPagesJSONContent.at(-1) ?? '\n') === this.resolvedPagesJSONNewline
  }

  private async getIndent() {
    if (!this.resolvedPagesJSONIndent) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONIndent!
  }

  private async getNewline() {
    if (!this.resolvedPagesJSONNewline) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONNewline!
  }

  private async getEndOfLine() {
    if (!this.resolvedPagesJSONEofNewline) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONEofNewline!
  }
}

/**
 * Get all page paths in the specified directory
 * @param dir - Page directory path
 * @param options - Resolved configuration options
 * @returns Page path array containing relative and absolute paths
 */
function getPagePaths(dir: string, options: ResolvedOptions) {
  const pagesDirPath = slash(path.resolve(options.root, dir))
  const basePath = slash(path.join(options.root, options.outDir))
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
 * Merge multi-platform page configuration items
 * Handle conditional compilation comments (#ifdef / #endif), merge configuration items from different platforms into one array
 * Same configuration items will automatically merge platform identifiers, different configuration items will keep conditional compilation comments
 *
 * @param source - Existing configuration item array (from pages.json)
 * @param currentPlatform - Current platform identifier (e.g. H5, MP-WEIXIN)
 * @param items - New configuration item array
 * @param uniqueKeyName - Field name used to identify configuration item uniqueness (e.g. 'path' or 'pagePath')
 * @returns Merged configuration item array with conditional compilation comments
 */
function mergePlatformItems<T = any>(source: any[] | undefined, currentPlatform: string, items: T[], uniqueKeyName: keyof ExcludeIndexSignature<T>): CommentArray<CommentObject> {
  const src = (source as CommentArray<CommentObject>) || new CommentArray<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. Extract the first comment from CommentArray and get platforms as lastPlatforms
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    const trimed = comment.value.trim()
    if (trimed.startsWith('GENERATED BY UNI-PAGES, PLATFORM:')) {
      // Remove current platform
      lastPlatforms = trimed.split(':')[1].split('||').map(s => s.trim()).filter(s => s !== currentPlatform).sort()
    }
  }

  // 2. Iterate source, judge each element, then add to new tmpMap using uniqueKey element value as key
  interface MultiPlatformItem {
    item: T
    itemStr: string
    platforms: string[]
    platformStr: string
  }
  const tmpMap = new Map<string, MultiPlatformItem[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as T
    const uniqueKey = (item as any)[uniqueKeyName]

    if (!uniqueKey) {
      continue
    }

    // Check if there are conditional compilation comments
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // const afterComments = src[Symbol.for(`after:${i}`) as CommentSymbol]

    const ifdefComment = beforeComments?.find(c => c.value.trim().startsWith('#ifdef'))
    // const endifComment = afterComments?.find(c => c.value.trim().startsWith('#endif'))

    let platforms: string[] = [...lastPlatforms]

    if (ifdefComment) {
      const match = ifdefComment.value.match(/#ifdef\s+(.+)/)
      if (match) {
        // Remove current platform
        platforms = match[1].split('||').map(p => p.trim()).filter(s => s !== currentPlatform).sort()
      }
    }

    // Skip if platforms is empty except for current platform
    if (platforms.length === 0) {
      continue
    }

    const existing = tmpMap.get(uniqueKey) || []
    existing.push({ item, itemStr: JSON.stringify(item), platforms, platformStr: platforms.join(' || ') })
    tmpMap.set(uniqueKey, existing)
  }

  // 3. Merge items into tmpMap
  for (const item of items) {
    const newItem = item
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey) {
      continue
    }

    if (!tmpMap.has(uniqueKey)) {
      // If not exists, add to newMap
      tmpMap.set(uniqueKey, [{
        item: newItem,
        itemStr: JSON.stringify(newItem),
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      }])
      continue
    }

    // If exists, check if elements are equal
    const existing = tmpMap.get(uniqueKey)!

    const newItemStr = JSON.stringify(newItem)
    const equalObj = existing.find(val => val.itemStr === newItemStr)
    if (equalObj) {
      equalObj.platforms.push(currentPlatform)
      equalObj.platforms.sort()
      equalObj.platformStr = equalObj.platforms.join(' || ')
    }
    else {
      existing.push({
        item: newItem,
        itemStr: newItemStr,
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      })
    }
  }

  // 4. Iterate tmpMap to generate result:CommentArray<CommentObject>
  const result = new CommentArray<CommentObject>()

  // Check platform usage frequency, use the most frequently used platform as default
  const platformUsage: Record<string, number> = {}
  tmpMap.forEach((val) => {
    Object.values(val).forEach((v) => {
      platformUsage[v.platformStr] = (platformUsage[v.platformStr] || 0) + 1
    })
  })
  const usageKeys = Object.keys(platformUsage)
  const defaultPlatformStr = usageKeys.length
    ? usageKeys.reduce((a, b) => (platformUsage[a] > platformUsage[b] ? a : b))
    : currentPlatform

  // Add generation identifier comment to result's Symbol.for(`before:0`)
  result[Symbol.for('before:0') as CommentSymbol] = [{
    type: 'LineComment',
    value: ` GENERATED BY UNI-PAGES, PLATFORM: ${defaultPlatformStr}`,
    inline: false,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }]

  // Process elements in insertion order
  for (const [_, list] of tmpMap) {
    for (const { item, platformStr } of list) {
      result.push(item as CommentObject)

      // Check if platforms matches defaultPlatformStr (platforms and defaultPlatforms are pre-sorted)
      if (platformStr !== defaultPlatformStr) {
      // Platform info exists and differs from default platform, add conditional compilation comments
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [{
          type: 'LineComment',
          value: ` #ifdef ${platformStr}`,
          inline: false,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        }]

        result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = [{
          type: 'LineComment',
          value: ' #endif',
          inline: false,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        }]
      }
    }
  }

  // 5. Return result:CommentArray<CommentObject>
  return result
}
