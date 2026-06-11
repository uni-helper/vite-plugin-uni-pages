import type { LoadConfigSource } from 'unconfig'
import type { PagesConfig } from './config'
import type { PageContext } from './context'
import type { debug } from './utils'

export type { DefinePage, ExcludeIndexSignature, MaybeCallable, MaybePromise, MaybePromiseCallable, PageMetaDatum, SubPageMetaDatum, UserPageMeta, UserTabBarItem } from '@uni-helper/uni-pages-types'
export type { definePage } from '@uni-helper/uni-pages-types'

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
   * Sub-package page directories for uni-app sub-package loading
   *
   * Supports string format (directory path) or object format (custom root in pages.json)
   *
   * In monorepo projects, pages may be located outside the project root.
   * Use object format to specify a custom root that appears in pages.json,
   * avoiding '..' in the generated root path.
   *
   * @see https://github.com/uni-helper/vite-plugin-uni-pages/issues/271
   * @default []
   */
  subPackages: (string | SubPackageConfig)[]

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
export interface ResolvedOptions extends Omit<Options, 'dir' | 'homePage' | 'configSource' | 'dts' | 'subPackages'> {
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

  /**
   * Resolved sub-package directories
   */
  subPackages: string[]

  /**
   * Custom root mapping for sub-packages (dir -> root)
   * Used for monorepo support to specify custom root paths in pages.json
   */
  subPackageRootMap: Map<string, string>
}

/**
 * Sub-package configuration interface
 * Allows customizing the root path in pages.json for monorepo support
 *
 * In monorepo projects, pages may be located outside the project root (e.g., ../../packages/login/src/pages).
 * By default, the plugin generates root paths with '..', which uni-app does not support.
 * Use this config to specify a custom root that appears in pages.json instead.
 *
 * @example
 * ```ts
 * subPackages: [
 *   {
 *     dir: '../../packages/login/src/pages',  // Physical directory to scan
 *     root: 'packages/login/src/pages',       // Custom root in pages.json
 *   }
 * ]
 * ```
 */
export interface SubPackageConfig {
  /** Physical directory path to scan for page files */
  dir: string
  /** Custom root path that appears in pages.json subPackages.root */
  root: string
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
