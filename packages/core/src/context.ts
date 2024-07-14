import path from 'node:path'
import process from 'node:process'
import type { FSWatcher } from 'chokidar'
import type { Logger, ViteDevServer } from 'vite'
import { normalizePath } from 'vite'
import { loadConfig } from 'unconfig'
import { slash } from '@antfu/utils'
import dbg from 'debug'
import { platform } from '@uni-helper/uni-env'
import detectIndent from 'detect-indent'
import detectNewline from 'detect-newline'
import type { PagesConfig } from './config/types'
import type { PageMetaDatum, PagePath, ResolvedOptions, SubPageMetaDatum, UserOptions } from './types'
import { writeDeclaration } from './declaration'

import {
  debug,
  invalidatePagesModule,
  isTargetFile,
  mergePageMetaDataArray,
  useCachedPages,
} from './utils'
import { resolveOptions } from './options'
import { checkPagesJsonFile, getPageFiles, readFileSync, writeFileSync } from './files'
import { getRouteBlock, getRouteSfcBlock } from './customBlock'
import { OUTPUT_NAME } from './constant'

let lsatPagesJson = ''

const { setCache, hasChanged } = useCachedPages()
export class PageContext {
  private _server: ViteDevServer | undefined

  pagesGlobConfig: PagesConfig | undefined
  pagesConfigSourcePaths: string[] = []

  pagesPath: PagePath[] = []
  subPagesPath: Record<string, PagePath[]> = {}
  pageMetaData: PageMetaDatum[] = []
  subPageMetaData: SubPageMetaDatum[] = []

  resolvedPagesJSONPath = ''
  resolvedPagesJSONIndent = '  '
  resolvedPagesJSONNewline = '\n'
  resolvedPagesJSONEofNewline = true

  rawOptions: UserOptions
  root: string
  options: ResolvedOptions
  logger?: Logger

  withUniPlatform = false

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
    const resolvedPagesJSONContent = readFileSync(this.resolvedPagesJSONPath)
    this.resolvedPagesJSONIndent = detectIndent(resolvedPagesJSONContent).indent || '  '
    this.resolvedPagesJSONNewline = detectNewline(resolvedPagesJSONContent) || '\n'
    this.resolvedPagesJSONEofNewline = (resolvedPagesJSONContent.at(-1) ?? '\n') === this.resolvedPagesJSONNewline
    debug.options(this.options)
  }

  setLogger(logger: Logger) {
    this.logger = logger
  }

  async loadUserPagesConfig() {
    const configSource = this.options.configSource
    const { config, sources } = await loadConfig<PagesConfig>({ cwd: this.root, sources: configSource, defaults: {} })
    this.pagesGlobConfig = config.default || config
    this.pagesConfigSourcePaths = sources
    debug.options(this.pagesGlobConfig)
  }

  async scanPages() {
    const pageDirFiles = this.options.dirs.map((dir) => {
      return { dir, files: getPagePaths(dir, this.options) }
    })

    this.pagesPath = pageDirFiles.map(page => page.files).flat()
    debug.pages(this.pagesPath)
  }

  async scanSubPages() {
    const subPagesPath: Record<string, PagePath[]> = {}
    for (const dir of this.options.subPackages) {
      const pagePaths = getPagePaths(dir, this.options)
      subPagesPath[dir] = pagePaths
    }
    this.subPagesPath = subPagesPath
    debug.subPages(this.subPagesPath)
  }

  setupViteServer(server: ViteDevServer) {
    if (this._server === server)
      return

    this._server = server
    this.setupWatcher(server.watcher)
  }

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

  onUpdate() {
    if (!this._server)
      return

    invalidatePagesModule(this._server)
    debug.hmr('Reload generated pages.')
    this._server.ws.send({
      type: 'full-reload',
    })
  }

  async parsePage(page: PagePath): Promise<PageMetaDatum> {
    const { relativePath, absolutePath } = page
    const routeSfcBlock = await getRouteSfcBlock(absolutePath)
    const routeBlock = await getRouteBlock(absolutePath, routeSfcBlock, this.options)
    setCache(absolutePath, routeSfcBlock)
    const relativePathWithFileName = relativePath.replace(path.extname(relativePath), '')
    const pageMetaDatum: PageMetaDatum = {
      path: normalizePath(relativePathWithFileName),
      type: routeBlock?.attr.type ?? 'page',
    }

    if (routeBlock)
      Object.assign(pageMetaDatum, routeBlock.content)

    return pageMetaDatum
  }

  /**
   * parse pages rules && set page type
   * @param pages page path array
   * @param type  page type
   * @param overrides custom page config
   * @returns pages rules
   */
  async parsePages(pages: PagePath[], type: 'main' | 'sub', overrides?: PageMetaDatum[]) {
    const generatedPageMetaData = await Promise.all(pages.map(async page => await this.parsePage(page)))
    const customPageMetaData = overrides || []

    const result = customPageMetaData.length
      ? mergePageMetaDataArray(generatedPageMetaData.concat(customPageMetaData))
      : generatedPageMetaData

    const parseMeta = result.filter((page, index, self) =>
      self.findLastIndex(item => page.path === item.path) === index,
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
      const isFoundHome = result.some((item) => {
        const isFound = this.options.homePage.find(v => (v === item.path))
        if (isFound)
          item.type = 'home'

        return isFound
      })

      if (!isFoundHome) {
        this.logger?.warn('No home page found, check the configuration of pages.config.ts, or add the `homePage` option to UniPages in vite.config.js, or add `type="home"` to the routeBlock of your vue page.', {
          timestamp: true,
        })
      }
    }

    result.sort(page => (page.type === 'home' ? -1 : 0))

    return result
  }

  async mergePageMetaData() {
    const pageMetaData = await this.parsePages(this.pagesPath, 'main', this.pagesGlobConfig?.pages)

    this.pageMetaData = pageMetaData
    debug.pages(this.pageMetaData)
  }

  async mergeSubPageMetaData() {
    const subPageMaps: Record<string, PageMetaDatum[]> = {}
    const subPackages = this.pagesGlobConfig?.subPackages || []

    for (const [dir, pages] of Object.entries(this.subPagesPath)) {
      const basePath = slash(path.join(this.options.root, this.options.outDir))
      const root = slash(path.relative(basePath, path.join(this.options.root, dir)))

      const globPackage = subPackages?.find(v => v.root === root)
      subPageMaps[root] = await this.parsePages(pages, 'sub', globPackage?.pages)
      subPageMaps[root] = subPageMaps[root].map(page => ({ ...page, path: slash(path.relative(root, page.path)) }))
    }

    // Inherit subPackages that do not exist in the config
    for (const { root, pages } of subPackages) {
      if (root && !subPageMaps[root])
        subPageMaps[root] = pages || []
    }

    const subPageMetaData = Object.keys(subPageMaps)
      .map(root => ({ root, pages: subPageMaps[root] }))
      .filter(meta => meta.pages.length > 0)

    this.subPageMetaData = subPageMetaData
    debug.subPages(this.subPageMetaData)
  }

  async updatePagesJSON(filepath?: string) {
    if (filepath) {
      if (!await hasChanged(filepath)) {
        debug.cache(`The route block on page ${filepath} did not send any changes, skipping`)
        return false
      }
    }

    checkPagesJsonFile(this.resolvedPagesJSONPath)
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
      ? this.pageMetaData.filter(v => !/\..*$/.test(v.path) || v.path.includes(platform)).map(v => ({ ...v, path: v.path.replace(/\..*$/, '') }))
      : this.pageMetaData
    pages.forEach(v => pagesMap.set(v.path, v))
    this.pageMetaData = [...pagesMap.values()]

    this.options.onBeforeWriteFile(this)

    const data = {
      ...this.pagesGlobConfig,
      pages: this.pageMetaData,
      subPackages: this.subPageMetaData,
    }

    const pagesJson = JSON.stringify(
      data,
      null,
      this.options.minify ? undefined : this.resolvedPagesJSONIndent,
    ) + (
      this.resolvedPagesJSONEofNewline ? this.resolvedPagesJSONNewline : ''
    )
    this.generateDeclaration()
    if (lsatPagesJson === pagesJson) {
      debug.pages('PagesJson Not have change')
      return false
    }

    writeFileSync(this.resolvedPagesJSONPath, pagesJson)
    lsatPagesJson = pagesJson

    this.options.onAfterWriteFile(this)
    return true
  }

  virtualModule() {
    const pages = `export const pages = ${this.resolveRoutes()};`
    const subPackages = `export const subPackages = ${this.resolveSubRoutes()};`
    return [pages, subPackages].join('\n')
  }

  resolveRoutes() {
    return JSON.stringify(this.pageMetaData, null, 2)
  }

  resolveSubRoutes() {
    return JSON.stringify(this.subPageMetaData, null, 2)
  }

  generateDeclaration() {
    if (!this.options.dts)
      return

    debug.declaration('generating')
    return writeDeclaration(this, this.options.dts)
  }
}

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
