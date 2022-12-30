import type { PageContext } from './context'

export type CustomBlock = Record<string, any>

export interface Options {
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
  onBeforeMergePagesMeta: (ctx: PageContext) => void
  onAfterMergePagesMeta: (ctx: PageContext) => void
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
  path: string
  type: string
  [x: string]: any
}
