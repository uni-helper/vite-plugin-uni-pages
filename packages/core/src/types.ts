import type { LoadConfigSource } from 'unconfig'
import type { DefineConditional } from './condition'
import type { PageItem, PagesConfig, SubPackages, TabBarItem } from './config'
import type { debug } from './logger'
import type { Page } from './page'

/**
 * Exclude index signature keys from an object type, keeping only explicit keys
 */
export type ExcludeIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K]
}

/**
 * Internal page metadata
 * Extends the document-level PageItem with the plugin-internal `type` marker.
 * Plugin-generated entries keep it in pages.json by design (it powers the
 * home fallback in later runs); only the cross-platform equality comparison
 * normalizes it away
 */
export interface InternalPageItem extends PageItem {
  /** Internal marker used by the plugin to identify the home page */
  type?: 'home' | 'page'
}

export type InternalPages = InternalPageItem[]

/**
 * tabBar item that users can define in the definePage macro
 * Extends the document-level TabBarItem with plugin-only fields
 */
export interface UserTabBarItem extends Partial<TabBarItem> {
  /**
   * Page path, filled automatically by the plugin when omitted
   *
   * @deprecated Use pagePath from pages.json instead
   */
  pagePath?: string
  /**
   * Index used by the plugin to sort tabBar items
   *
   * @default 0
   */
  index?: number
}

/**
 * Page metadata that users can define in the definePage macro
 * Extends the document-level PageItem with plugin-only fields
 */
export interface UserPageItem extends Partial<PageItem> {
  /**
   * @deprecated Use path from pages.json instead
   */
  path?: string
  /**
   * Page type, set to "home" to mark the home page
   */
  type?: 'home' | 'page'
  /**
   * tabBar item configuration, the plugin collects it to generate pages.json tabBar.list
   */
  tabBar?: UserTabBarItem
  [x: string]: any
}

/** Value or Promise of the value */
export type MaybePromise<T> = T | Promise<T>

/** Value or function returning the value */
export type MaybeCallable<T> = T | (() => T)

/** Value, function returning the value, or function returning a Promise of the value */
export type MaybePromiseCallable<T> = T | (() => T) | (() => Promise<T>)

/**
 * Context injected into function-form definePage macros
 */
export interface DefinePageContext {
  /** Current platform identifier, e.g. 'mp-weixin' */
  platform: string
  /**
   * Create a platform-conditional page metadata definition
   *
   * Usage: `define(base).ifdef(platforms, partial).ifndef(platforms, partial)`.
   * Matching branches are deep-merged into `base` in declaration order:
   * objects merge recursively, arrays and primitives are replaced.
   * `h5` and `web` are aliases of the same platform, so listing either
   * one in a branch covers both.
   */
  define: (base: UserPageItem) => DefineConditional
}

/**
 * Define page metadata in a Vue page file
 * The macro call is removed by the plugin during build
 *
 * Return `null` (or pass `null` directly) to exclude the page from
 * pages.json on the current platform. Use the injected `define` factory
 * for platform-conditional metadata without manual platform branching.
 */
export declare function definePage(options: UserPageItem | null | ((context: DefinePageContext) => MaybePromise<UserPageItem | DefineConditional | null>)): void

/** Type of the definePage macro */
export type DefinePage = typeof definePage

/** Debug log type, corresponding to methods in the debug object */
export type DebugType = keyof typeof debug

/**
 * @deprecated Use {@link DebugType} instead
 */
export type debugType = DebugType

/** Configuration source type, supports string path or unconfig LoadConfigSource object */
export type ConfigSource = string | LoadConfigSource<PagesConfig> | LoadConfigSource<PagesConfig>[]

/**
 * Plugin configuration options interface
 * Defines all configuration options that users can pass in
 *
 * Internal pipeline: load user config -> scan page files -> merge page
 * metadata -> generate and write pages.json
 */
export interface Options {

  /**
   * Generate TypeScript declaration for pages path
   *
   * When `true`, generates `uni-pages.d.ts` in the project root.
   * When a string, used as a custom output path relative to the project root.
   *
   * @default true
   * @since 0.2.9
   */
  dts?: boolean | string
  /**
   * Loading source of the page config file
   *
   * Based on unconfig, supports merging multiple config sources
   *
   * @default 'pages.config'
   * @since 0.2.7
   */
  configSource: ConfigSource
  /**
   * Default application entry page (home page)
   *
   * Used when no page is marked as home via `definePage({ type: 'home' })`.
   * Supports multiple path styles for compatibility with different directory layouts.
   *
   * @default ['pages/index', 'pages/index/index']
   * @since 0.1.9
   */
  homePage: string | string[]

  /**
   * Whether to auto-scan directories and merge page configs into pages.json
   *
   * When disabled, only the user config file is loaded and the filesystem is not scanned
   *
   * @default true
   * @since 0.1.0
   */
  mergePages: boolean

  /**
   * Search directory for main package pages
   *
   * Supports glob patterns, e.g. 'src/{pages,views}'.
   * The final result is resolved by tinyglobby into a list of matched directories.
   *
   * @default 'src/pages'
   * @since 0.1.0
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
   * @since 0.1.8
   */
  subPackages: (string | SubPackageConfig)[]

  /**
   * Directory of pages.json
   *
   * Relative to the project root, also the base for computing page relative paths
   *
   * @default 'src'
   * @since 0.0.1
   */
  outDir: string

  /**
   * File/directory patterns to exclude
   *
   * Based on the [tinyglobby ignore option](https://superchupu.dev/tinyglobby/documentation#ignore)
   *
   * @default ['node_modules', '.git', '**\/__*__/**']
   * @since 0.0.4
   */
  exclude: string[]

  /**
   * Minify the generated pages.json
   * @default false
   * @since 0.1.6
   */
  minify: boolean

  /**
   * Whether to insert a final newline at the end of the generated pages.json
   * @default false
   * @since 0.5.0
   */
  insertFinalNewline: boolean

  /**
   * Indentation of the generated pages.json
   *
   * Accepts a number of spaces or a string (e.g. `'\t'`)
   *
   * Ignored when `minify` is `true`
   * @default 2
   * @since 0.5.0
   */
  indent: number | string

  /**
   * Line ending of the generated pages.json
   * @default '\n'
   * @since 0.5.0
   */
  eol: '\n' | '\r\n'

  /**
   * Enable debug logs
   *
   * When `true`, enables all categories; when a string, enables only the
   * specific category. Available categories:
   * hmr | options | pages | subPages | error | cache | declaration | definePage.
   * Can also be controlled via the DEBUG=vite-plugin-uni-pages:* environment variable.
   *
   * @default false
   * @since 0.1.8
   */
  debug: boolean | DebugType

  /**
   * Lifecycle hooks, fired at each pipeline stage. Hooks receive only the
   * stage's input or output data, never the whole context.
   *
   * @since 0.0.3
   */
  onBeforeLoadUserConfig: () => void
  onAfterLoadUserConfig: (pagesGlobConfig: PagesConfig | undefined) => void
  onBeforeScanPages: () => void
  onAfterScanPages: (pages: Map<string, Page>, subPages: Map<string, Map<string, Page>>) => void
  onBeforeMergePageMetaData: (pages: Map<string, Page>, pagesGlobConfig: PagesConfig | undefined) => void
  onAfterMergePageMetaData: (pageMetaData: InternalPages, subPageMetaData: SubPackages) => void
  onBeforeWriteFile: (filePath: string) => void
  onAfterWriteFile: (filePath: string, content: string) => void
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
