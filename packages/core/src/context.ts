import path from 'path'
import type { FSWatcher } from 'fs'
import type { Logger, ViteDevServer } from 'vite'
import { loadConfig } from 'unconfig'
import { slash } from '@antfu/utils'
import type { PagesConfig } from './config/types'
import type { PageMetaDatum, PagePath, ResolvedOptions, UserOptions } from './types'
import { debug, invalidatePagesModule, isTargetFile, mergePageMetaDataArray } from './utils'
import { resolveOptions } from './options'
import { checkPagesJsonFile, getPageFiles, writeFileSync } from './files'
import { getRouteBlock } from './customBlock'
import { OUTPUT_NAME } from './constant'

export class PageContext {
  private _server: ViteDevServer | undefined

  pagesGlobConfig: PagesConfig | undefined
  pagesPath: PagePath[] = []
  pageMetaData: PageMetaDatum[] = []
  resolvedPagesJSONPath = ''

  rawOptions: UserOptions
  root: string
  options: ResolvedOptions
  logger?: Logger

  constructor(userOptions: UserOptions, viteRoot: string = process.cwd()) {
    this.rawOptions = userOptions
    this.root = slash(viteRoot)
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    this.resolvedPagesJSONPath = path.join(this.root, this.options.outDir, OUTPUT_NAME)
    debug.options(this.options)
  }

  setLogger(logger: Logger) { this.logger = logger }

  async loadUserPagesConfig() {
    const { config } = await loadConfig<PagesConfig>({ sources: [{ files: 'pages.config' }] })
    if (!config) {
      this.logger?.warn('Can\'t found pages.config, please create pages.config.(ts|mts|cts|js|cjs|mjs|json)')
      process.exit(-1)
    }
    this.pagesGlobConfig = config
    debug.options(config)
  }

  async scanPages() {
    const pageDirFiles = this.options.dirs.map((dir) => {
      const pagesDirPath = slash(path.resolve(this.options.root, dir))
      const basePath = slash(path.join(this.options.root, this.options.outDir))
      const files = getPageFiles(pagesDirPath, this.options)
      debug.pages(dir, files)
      const pagePaths = files.map(file => slash(file))
        .map(file => ({
          relativePath: path.relative(basePath, slash(path.resolve(pagesDirPath, file))),
          absolutePath: slash(path.resolve(pagesDirPath, file)),
        }))

      return { dir, files: pagePaths }
    })

    this.pagesPath = pageDirFiles.map(page => page.files).flat()
    debug.pages(this.pagesPath)
  }

  setupViteServer(server: ViteDevServer) {
    if (this._server === server)
      return

    this._server = server
    this.setupWatcher(server.watcher)
  }

  setupWatcher(watcher: FSWatcher) {
    watcher.on('add', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return

      debug.pages(`File added: ${path}`)
      this.updatePagesJSON()
      this.onUpdate()
    })

    watcher.on('change', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return

      debug.pages(`File changed: ${path}`)
      this.updatePagesJSON()
      this.onUpdate()
    })

    watcher.on('unlink', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return

      debug.pages(`File removed: ${path}`)
      this.updatePagesJSON()
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
    const routeBlock = await getRouteBlock(absolutePath, this.options)
    const relativePathWithFileName = relativePath.replace(path.extname(relativePath), '')
    const pageMetaDatum: PageMetaDatum = { path: relativePathWithFileName, type: 'page' }

    if (routeBlock)
      Object.assign(pageMetaDatum, routeBlock)

    return pageMetaDatum
  }

  async mergePageMetaData() {
    const generatedPageMetaData = await Promise.all(
      this.pagesPath.map(async page => await this.parsePage(page)),
    )
    if (this.pagesGlobConfig?.pages) {
      const customPageMetaData = this.pagesGlobConfig?.pages || []
      this.pageMetaData = mergePageMetaDataArray(generatedPageMetaData.concat(customPageMetaData))
    }
    else {
      this.pageMetaData = generatedPageMetaData
    }
    debug.pages(generatedPageMetaData)
  }

  async updatePagesJSON() {
    checkPagesJsonFile(this.resolvedPagesJSONPath)
    this.options.onBeforeLoadUserConfig(this)
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this)

    this.options.onBeforeScanPages(this)
    await this.scanPages()
    this.options.onAfterScanPages(this)

    this.options.onBeforeMergePageMetaData(this)
    await this.mergePageMetaData()
    this.options.onAfterMergePageMetaData(this)

    this.options.onBeforeWriteFile(this)
    const pagesJson = JSON.stringify({ ...this.pagesGlobConfig, pages: this.pageMetaData }, null, 2)
    writeFileSync(this.resolvedPagesJSONPath, pagesJson)
    this.options.onAfterWriteFile(this)
  }

  async virtualModule() {
    return `export const pages = ${JSON.stringify(this.pageMetaData, null, 2)};`
  }
}
