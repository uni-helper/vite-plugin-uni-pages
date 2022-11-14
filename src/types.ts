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
}

export interface UserOptions extends Partial<Options> {}

export interface ResolvedOptions extends Options {}
