import type { LoadConfigSource } from 'unconfig'
import type { PagesConfig } from './config'
import type { PageContext } from './context'
import type { debug } from './utils'

export type { DefinePage, ExcludeIndexSignature, MaybeCallable, MaybePromise, MaybePromiseCallable, PageMetaDatum, SubPageMetaDatum, UserPageMeta, UserTabBarItem } from '@uni-helper/uni-pages-types'
export { definePage } from '@uni-helper/uni-pages-types'

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
