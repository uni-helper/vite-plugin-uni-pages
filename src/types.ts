import type { Context } from "./context";
export interface Options {
  /**
   * pages dir
   * @default "src/pages"
   */
  pagesDir: string;

  /**
   * pages.json dir
   * @default "src"
   */
  outDir: string;

  /**
   * pages config entry
   * @default "pages.config"
   */
  entry: string;

  /**
   * pages config extension
   * @default "ts"
   */
  extension: string;

  onBeforeLoadUserConfig: (ctx: Context) => void;
  onAfterLoadUserConfig: (ctx: Context) => void;
  onBeforeScanPages: (ctx: Context) => void;
  onAfterScanPages: (ctx: Context) => void;
  onBeforeMergePagesMeta: (ctx: Context) => void;
  onAfterMergePagesMeta: (ctx: Context) => void;
  onBeforeWriteFile: (ctx: Context) => void;
  onAfterWriteFile: (ctx: Context) => void;
}

export interface UserOptions extends Partial<Options> {}

export interface ResolvedOptions extends Options {}

export interface PagePathInfo {
  relative: string;
  absolute: string;
}

export interface PageMeta {
  path: string;
  type: string;
  [x: string]: any;
}
