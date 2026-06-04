import type { LoadConfigSource } from 'unconfig'
import type { PagesConfig } from './config'
import type { PageContext } from './context'
import type { debug } from './utils'

export type { DefinePage, ExcludeIndexSignature, MaybeCallable, MaybePromise, MaybePromiseCallable, PageMetaDatum, SubPageMetaDatum, UserPageMeta, UserTabBarItem } from '@uni-helper/uni-pages-types'
export { definePage } from '@uni-helper/uni-pages-types'

/** Debug log type, corresponding to methods in the debug object */
export type debugType = keyof typeof debug

/** Configuration source type, supports string path or unconfig LoadConfigSource object */
export type ConfigSource = string | LoadConfigSource<PagesConfig> | LoadConfigSource<PagesConfig>[]

/**
 * Plugin configuration options interface
 * Defines all configuration options that users can pass in
 */
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
   * pages to be excluded, based on [tinyglobby ignore option](https://superchupu.dev/tinyglobby/documentation#ignore)
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

/** User configuration options type, all options are optional */
export type UserOptions = Partial<Options>

/**
 * Resolved configuration options interface
 * Configuration processed by resolveOptions, all paths resolved to absolute paths
 */
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

/**
 * Page path information interface
 * Contains relative and absolute paths of page files
 */
export interface PagePath {
  /** Path relative to the output directory */
  relativePath: string
  /** Absolute path of the page file */
  absolutePath: string
}
