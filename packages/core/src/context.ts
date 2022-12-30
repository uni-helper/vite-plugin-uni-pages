import path from 'path'
import type { FSWatcher } from 'fs'
import fs from 'fs'
import type { Logger, ViteDevServer } from 'vite'
import fg from 'fast-glob'
import { loadConfig } from 'unconfig'
import { slash } from '@antfu/utils'
import type { PagesConfig } from './config/types'
import type { PageMetaDatum, PagePath, ResolvedOptions, UserOptions } from './types'
import { debug, invalidatePagesModule, isPagesDir } from './utils'
import { resolveOptions } from './options'
import { getPageFiles } from './files'
import { getRouteBlock } from './customBlock'
import { OUTPUT_NAME } from './constant'

export class PageContext {
  private _server: ViteDevServer | undefined

  pagesGlobConfig: PagesConfig | undefined
  pagePaths: PagePath[] = []
  pagesMetaData: PageMetaDatum[] = []
  resolvedPageJSONPath = ''

  rawOptions: UserOptions
  root: string
  options: ResolvedOptions
  logger?: Logger

  constructor(userOptions: UserOptions, viteRoot: string = process.cwd()) {
    this.rawOptions = userOptions
    this.root = slash(viteRoot)
    debug.env('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    this.resolvedPageJSONPath = path.join(this.root, this.options.outDir, OUTPUT_NAME)
    debug.options(this.options)
  }

  setLogger(logger: Logger) { this.logger = logger }

  async loadUserPagesConfig() {
    const { config } = await loadConfig({
      sources: [{ files: 'pages.config' }],
      merge: false,
    })
    if (!config) {
      this.logger?.warn(
        'Can\'t found pages.config, please create pages.config.(ts|mts|cts|js|cjs|mjs|json)',
      )
      process.exit(-1)
    }
    this.pagesGlobConfig = config as PagesConfig
    debug.env(config)
  }

  async scanPages() {
    const pageDirFiles = this.options.dirs.map((dir) => {
      const pagesDirPath = slash(path.resolve(this.options.root, dir))
      const basePath = slash(path.join(this.options.root, this.options.outDir))
      const files = getPageFiles(pagesDirPath, this.options)
      debug.search(dir, files)
      const pagePaths = files.map(file => slash(file))
        .map(file => ({
          relativePath: path.relative(basePath, slash(path.resolve(pagesDirPath, file))),
          absolutePath: slash(path.resolve(pagesDirPath, file)),
        }))

      return {
        dir,
        files: pagePaths,
      }
    })

    this.pagePaths = pageDirFiles.map(page => page.files).flat()
    debug.pages(this.pagePaths)
  }

  setupViteServer(server: ViteDevServer) {
    if (this._server === server)
      return

    this._server = server
    this.setupWatcher(server.watcher)
  }

  setupWatcher(watcher: FSWatcher) {
    watcher.on('change', async (path) => {
      path = slash(path)
      if (!isPagesDir(path, this.options))
        return
      this.updatePagesJSON()
      this.onUpdate()
    })

    watcher.on('unlink', async (path) => {
      path = slash(path)
      if (!isPagesDir(path, this.options))
        return
      this.updatePagesJSON()
      this.onUpdate()
    })

    watcher.on('add', async (path) => {
      path = slash(path)
      if (!isPagesDir(path, this.options))
        return
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

  get debug() {
    return debug
  }

  async virtualModule() {
    return `export const pages = ${JSON.stringify(this.pagesMetaData, null, 2)};`
  }

  async pagesConfigSourcePaths() {
    return await fg('pages.config.(ts|mts|cts|js|cjs|mjs|json)', {
      deep: 0,
      onlyFiles: true,
      absolute: true,
    })
  }

  async parsePage(page: PagePath): Promise<PageMetaDatum> {
    const { relativePath, absolutePath } = page
    const routeBlock = await getRouteBlock(absolutePath, this.options)
    const relativePathWithFileName = relativePath.replace(path.extname(relativePath), '')
    const pageMetaDatum: PageMetaDatum = {
      path: relativePathWithFileName,
      type: 'page',
    }
    if (routeBlock)
      Object.assign(pageMetaDatum, routeBlock)

    return pageMetaDatum
  }

  async mergePagesMeta() {
    const generatedPageMetadata = await Promise.all(
      this.pagePaths.map(async page => await this.parsePage(page)),
    )
    if (this.pagesGlobConfig?.pages) {
      const customPageMetadata = this.pagesGlobConfig?.pages || []
      const generatedPagePaths = generatedPageMetadata.map(page => page.path)
      const customPagePaths = customPageMetadata.map(page => page.path)

      // 检查是否有重复的 path，如果有，深度合并到 generatedPageMetadata
      const duplicatePaths = customPagePaths.filter(path => generatedPagePaths.includes(path))
      if (duplicatePaths.length > 0) {
        duplicatePaths.forEach((path) => {
          const customPage = customPageMetadata.find(page => page.path === path)
          const index = generatedPageMetadata.findIndex(page => page.path === path)
          Object.assign(generatedPageMetadata[index], customPage)
        })
      }
    }
    this.pagesMetaData = generatedPageMetadata
    debug.pages(generatedPageMetadata)
  }

  async updatePagesJSON() {
    this.checkPagesFile(this.resolvedPageJSONPath)
    this.options.onBeforeLoadUserConfig(this)
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this)

    this.options.onBeforeScanPages(this)
    await this.scanPages()
    this.options.onAfterScanPages(this)

    this.options.onBeforeMergePagesMeta(this)
    await this.mergePagesMeta()
    this.options.onAfterMergePagesMeta(this)

    this.options.onBeforeWriteFile(this)
    fs.writeFileSync(this.resolvedPageJSONPath, this.pagesJson(), { encoding: 'utf-8' })
    this.options.onAfterWriteFile(this)
  }

  pagesJson() {
    return JSON.stringify({ ...this.pagesGlobConfig, pages: this.pagesMetaData }, null, 2)
  }

  checkPagesFile(path: string) {
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path,
        JSON.stringify({ pages: [{ path: '' }] }, null, 2), { encoding: 'utf-8' },
      )
    }
  }
}
