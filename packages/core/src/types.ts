import type { LoadConfigSource } from 'unconfig'
import type { CommentJSONValue } from 'comment-json'
import type { GlobalStyle, PagesConfig } from './config'
import type { PageContext } from './context'
import type { debug } from './utils'

export interface CustomBlock {
  attr: Record<string, any>
  content: Record<string, any> | CommentJSONValue
}

export type debugType = keyof typeof debug

export type ConfigSource = string | LoadConfigSource<PagesConfig> | LoadConfigSource<PagesConfig>[]

export interface Options {

  /**
   * Generate TypeScript declaration for pages path
   *
   * Accept boolean or a path related to project root
   *
   * @default true
   */
  dts?: boolean | string
  /**
   * Load from configs files
   *
   * @default 'pages.config.(ts|mts|cts|js|cjs|mjs|json)',
   */
  configSource: ConfigSource
  /**
   * The default application entry page is the home page
   * @default 'pages/index' or 'pages/index/index'
   */
  homePage: string

  /**
   * Whether to merge pages in pages.json
   * @default true
   */
  mergePages: boolean

  /**
   * Paths to the directory to search for page components.
   * @default 'src/pages'
   */
  dir: string

  /**
   * all root directories loaded by subPackages
   * @default []
   */
  subPackages: string[]

  /**
   * pages.json dir
   * @default "src"
   */
  outDir: string

  /**
   * exclude page
   * @default []
   */
  exclude: string[]

  /**
   * Set the default route block parser, or use `<route lang="xxx">` in SFC route block
   * @default 'json5'
   */
  routeBlockLang: 'json5' | 'jsonc' | 'json' | 'yaml' | 'yml'

  /**
   * minify the `pages.json`
   * @default false
   */
  minify: boolean

  /**
   * enable debug log
   */
  debug: boolean | debugType

  onBeforeLoadUserConfig: (ctx: PageContext) => void
  onAfterLoadUserConfig: (ctx: PageContext) => void
  onBeforeScanPages: (ctx: PageContext) => void
  onAfterScanPages: (ctx: PageContext) => void
  onBeforeMergePageMetaData: (ctx: PageContext) => void
  onAfterMergePageMetaData: (ctx: PageContext) => void
  onBeforeWriteFile: (ctx: PageContext) => void
  onAfterWriteFile: (ctx: PageContext) => void
}

export type UserOptions = Partial<Options>

export interface ResolvedOptions extends Omit<Options, 'dir' | 'homePage' | 'configSource' | 'dts'> {
  /**
   * Resolves to the `root` value from Vite config.
   * @default config.root
   */
  root: string

  dts: string | false

  /**
   * Resolved page dirs
   */
  dirs: string[]
  /**
   * Resolved entry page
   */
  homePage: string[]

  configSource: LoadConfigSource<PagesConfig>[]
}

export interface PagePath {
  relativePath: string
  absolutePath: string
}

export interface PageMetaDatum {
  /**
   * 配置页面路径
   */
  path: string
  type?: string
  /**
   * 配置页面窗口表现，配置项参考下方 pageStyle
   */
  style?: GlobalStyle
  /**
   * 当前页面是否需要登录才可以访问，此配置优先级高于 uniIdRouter 下的 needLogin
   */
  needLogin?: boolean
  [x: string]: any
}

export interface SubPageMetaDatum {
  root: string
  pages: PageMetaDatum[]
}
