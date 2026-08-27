import type { UserOptions } from './types'
import process from 'node:process'
import { PageContext } from './context'

/**
 * 插件对外的主要入口
 *
 * "扫描 → 合并 → 写入"这一整套流程，在这里包成一次调用就能跑的
 * 函数。`root` 和 `platform` 可以从外面传进来，调用方和测试就不用
 * 受制于进程启动时定死的工作目录和环境变量。Vite 插件和 PageContext
 * 也是这里的调用方；测试通过这个入口跑完整流程，不去碰内部步骤。
 */

/** 可以从外面传进来的流水线输入 */
export interface PipelineOverrides {
  /** 项目根目录，默认为当前工作目录 */
  root?: string
  /** 当前平台标识，如 'mp-weixin'；默认取 uni-env 的平台 */
  platform?: string
}

/**
 * 创建 PageContext，并在内存里跑完「扫描/合并」
 *
 * 不写任何文件；路由数据通过 `resolveRoutes`、`resolveSubRoutes`、
 * `resolveTabBar` 和 `virtualModule` 取。
 *
 * @param userOptions - 用户配置项
 * @param overrides - 从外面传入的 root 与 platform
 * @returns 完成扫描与合并的 PageContext
 */
export async function createPages(userOptions: UserOptions = {}, overrides: PipelineOverrides = {}): Promise<PageContext> {
  const ctx = new PageContext(userOptions, overrides.root ?? process.cwd(), overrides.platform)
  await ctx.scanAndMerge()
  return ctx
}

/**
 * 运行完整流水线：加载用户配置、扫描、合并并写入 pages.json
 * （以及 TypeScript 声明文件）
 *
 * @param userOptions - 用户配置项
 * @param overrides - 从外面传入的 root 与 platform
 * @returns pages.json 是否有更新，以及产出它的上下文
 */
export async function generateAll(userOptions: UserOptions = {}, overrides: PipelineOverrides = {}): Promise<{ updated: boolean, ctx: PageContext }> {
  const ctx = new PageContext(userOptions, overrides.root ?? process.cwd(), overrides.platform)
  const updated = await ctx.updatePagesJSON()
  return { updated, ctx }
}
