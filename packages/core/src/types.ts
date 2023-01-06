import type { GlobalStyle } from './config'
import type { PageContext } from './context'

export type CustomBlock = Record<string, any>

export interface Options {
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
  routeBlockLang: 'json5' | 'json' | 'yaml' | 'yml'

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

export interface ResolvedOptions extends Omit<Options, 'dir'> {
  /**
   * Resolves to the `root` value from Vite config.
   * @default config.root
   */
  root: string

  /**
   * Resolved page dirs
   */
  dirs: string[]
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
  [x: string]: any
}
