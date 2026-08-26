import type { UserOptions } from './types'
import process from 'node:process'
import { PageContext } from './context'

/**
 * 插件的纯流水线接缝
 *
 * 把「扫描/合并/写入」流水线封装为一次调用即可完成的入口，`root` 与
 * `platform` 可注入，调用方与测试因此不必绑定模块加载时冻结的进程
 * 环境。Vite 插件与 PageContext 是本模块的另外两个调用方；测试经由
 * 这个接口穿越，而不是直接触碰内部阶段。
 */

/** 可注入的流水线输入 */
export interface PipelineOverrides {
  /** 项目根目录，默认为当前工作目录 */
  root?: string
  /** 当前平台标识，如 'mp-weixin'；默认取 uni-env 的平台 */
  platform?: string
}

/**
 * 创建 PageContext 并在内存中运行「扫描/合并」流水线
 *
 * 不写任何文件；结果通过 `resolveRoutes`、`resolveSubRoutes`、
 * `resolveTabBar` 与 `virtualModule` 暴露路由数据。
 *
 * @param userOptions - 用户配置项
 * @param overrides - 可注入的 root 与 platform
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
 * @param overrides - 可注入的 root 与 platform
 * @returns pages.json 是否有更新，以及产出它的上下文
 */
export async function generateAll(userOptions: UserOptions = {}, overrides: PipelineOverrides = {}): Promise<{ updated: boolean, ctx: PageContext }> {
  const ctx = new PageContext(userOptions, overrides.root ?? process.cwd(), overrides.platform)
  const updated = await ctx.updatePagesJSON()
  return { updated, ctx }
}
