import Debug from 'debug'

/**
 * Debug logging utility
 * Uses debug package for leveled log output
 * Enable via environment variable DEBUG=vite-plugin-uni-pages:*
 */
export const debug = {
  /** HMR related logs */
  hmr: Debug('vite-plugin-uni-pages:hmr'),
  /** Configuration options related logs */
  options: Debug('vite-plugin-uni-pages:options'),
  /** Main package page scanning logs */
  pages: Debug('vite-plugin-uni-pages:pages'),
  /** Sub-package page scanning logs */
  subPages: Debug('vite-plugin-uni-pages:subPages'),
  /** Error logs */
  error: Debug('vite-plugin-uni-pages:error'),
  /** Cache related logs */
  cache: Debug('vite-plugin-uni-pages:cache'),
  /** Declaration file generation logs */
  declaration: Debug('vite-plugin-uni-pages:declaration'),
  /** definePage macro parsing logs */
  definePage: Debug('vite-plugin-uni-pages:definePage'),
}
