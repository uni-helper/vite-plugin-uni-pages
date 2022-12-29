import { extname, join, relative, resolve } from 'path'
import fs from 'fs'
import { loadConfig } from 'unconfig'
import { normalizePath } from 'vite'
import fg from 'fast-glob'
import { parse as JSONParse } from 'jsonc-parser'
import { parse } from '@vue/compiler-dom'
import { defu } from 'defu'
import type { PageMeta, PagePathInfo, ResolvedOptions } from '../types'
import type { PagesConfig } from '../config/types'
import { logger } from '../utils'
export class Context {
  options: ResolvedOptions
  pagesConfig!: PagesConfig
  pagesPathInfo: PagePathInfo[] = []
  pagesMeta: PageMeta[] = []
  constructor(options: ResolvedOptions) {
    this.options = options
    this.createOrUpdatePagesJSON()
  }

  async loadUserPagesConfig() {
    const { config } = await loadConfig({
      sources: [
        {
          files: 'pages.config',
        },
      ],
      merge: false,
    })
    if (!config) {
      logger.error(
        'Can\'t found pages.config, please create pages.config.(ts|mts|cts|js|cjs|mjs|json)',
      )
      process.exit(-1)
    }
    logger.debug('Loaded user pages config', config)
    this.pagesConfig = config as PagesConfig
  }

  async scanPages() {
    const files = await fg('**/*.(vue|nvue|uvue)', {
      ignore: ['node_modules', '.git', '**/__*__/*', ...this.options.exclude],
      onlyFiles: true,
      cwd: resolve(process.cwd(), this.options.pagesDir),
    })
    const basePath = relative(
      resolve(process.cwd(), this.options.outDir),
      this.options.pagesDir,
    )
    this.pagesPathInfo = files.map((file) => {
      return {
        relative: normalizePath(join(basePath, file)),
        absolute: normalizePath(
          resolve(process.cwd(), this.options.pagesDir, file),
        ),
      }
    })
    logger.debug('Scanned pages dir', this.pagesPathInfo)
  }

  async parsePage({ relative, absolute }: PagePathInfo): Promise<PageMeta> {
    const code = await fs.promises.readFile(absolute, {
      encoding: 'utf-8',
    })
    const t = parse(code)
    const path = relative.replace(extname(relative), '')
    const pageMeta: PageMeta = {
      path,
      type: 'page',
    }
    t?.children.forEach((v) => {
      if (v.type !== 1)
        return

      if (v.tag === 'route') {
        v.props.forEach((prop) => {
          if (prop.type === 6 && prop.name === 'type')
            pageMeta.type = prop.value?.content ?? pageMeta.type
        })
        const astContent = v.children?.[0]
        if (astContent && astContent.type === 2) {
          const _pageMeta = JSONParse(astContent.content)
          Object.keys(_pageMeta).forEach((key) => {
            pageMeta[key] = _pageMeta[key]
          })
          // overwrite path
          pageMeta.path = path
        }
      }
    })
    return pageMeta
  }

  async mergePagesMeta() {
    const pagesMeta = await Promise.all(
      this.pagesPathInfo?.map(async page => await this.parsePage(page)),
    )
    const pages = Object.values(defu({}, pagesMeta, this.pagesConfig.pages))
    // @ts-expect-error
    pages.sort(a => (a.type === 'home' ? -1 : 0))
    // @ts-expect-error
    this.pagesMeta = pages
    logger.debug('merged pages', this.pagesMeta)
  }

  async createOrUpdatePagesJSON() {
    const outputName = 'pages.json'
    const resolvedOutput = normalizePath(
      resolve(process.cwd(), this.options.outDir, outputName),
    )

    // 如果不存在，先输出一个占位文件
    if (!fs.existsSync(resolvedOutput)) {
      fs.writeFileSync(resolvedOutput, '{"pages": [{"path": ""}]}', {
        encoding: 'utf-8',
      })
    }

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
    fs.writeFileSync(resolvedOutput, this.pagesJson, {
      encoding: 'utf-8',
    })
    this.options.onAfterWriteFile(this)
  }

  async virtualModule() {
    return `export const pages = ${JSON.stringify(this.pagesMeta)};`
  }

  async pagesConfigSourcePaths() {
    return await fg('pages.config.(ts|mts|cts|js|cjs|mjs|json)', {
      deep: 0,
      onlyFiles: true,
      absolute: true,
    })
  }

  get pagesJson() {
    return JSON.stringify({
      ...this.pagesConfig,
      pages: this.pagesMeta,
    })
  }
}
