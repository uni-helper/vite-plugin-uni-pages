import type { UserOptions } from './types'
import process from 'node:process'
import { PageContext } from './context'

/**
 * Pure pipeline seam of the plugin
 *
 * One-call entry points over the scan/merge/write pipeline, with `root` and
 * `platform` injectable so callers and tests are not bound to the process
 * environment frozen at module load time. The Vite plugin and PageContext are
 * the module's other two callers; tests cross this interface instead of
 * poking internal stages.
 */

/** Injectable pipeline inputs */
export interface PipelineOverrides {
  /** Project root directory, defaults to current working directory */
  root?: string
  /** Current platform identifier, e.g. 'mp-weixin'; defaults to the uni-env platform */
  platform?: string
}

/**
 * Create a PageContext and run the scan/merge pipeline in memory
 *
 * No file is written; the result exposes route data through `resolveRoutes`,
 * `resolveSubRoutes`, `resolveTabBar` and `virtualModule`.
 *
 * @param userOptions - User configuration options
 * @param overrides - Injectable root and platform
 * @returns PageContext with scanned and merged route data
 */
export async function createPages(userOptions: UserOptions = {}, overrides: PipelineOverrides = {}): Promise<PageContext> {
  const ctx = new PageContext(userOptions, overrides.root ?? process.cwd(), overrides.platform)
  await ctx.scanAndMerge()
  return ctx
}

/**
 * Run the full pipeline: load user config, scan, merge and write pages.json
 * (plus the TypeScript declaration)
 *
 * @param userOptions - User configuration options
 * @param overrides - Injectable root and platform
 * @returns Whether pages.json was updated and the context that produced it
 */
export async function generateAll(userOptions: UserOptions = {}, overrides: PipelineOverrides = {}): Promise<{ updated: boolean, ctx: PageContext }> {
  const ctx = new PageContext(userOptions, overrides.root ?? process.cwd(), overrides.platform)
  const updated = await ctx.updatePagesJSON()
  return { updated, ctx }
}
