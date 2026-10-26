import type { PagesConfig, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { InternalPages } from './types'

/**
 * 一次生成的完整路由快照。
 *
 * 虚拟模块、路由字符串和声明文件都从这里取值；生成过程本身仍可以使用
 * 可变的工作字段，但对外结果是一个值，便于测试和后续会话复用。
 */
export interface PagesSnapshot {
  pages: InternalPages
  subPackages: SubPackages
  tabBar?: TabBar
  globConfig?: PagesConfig
  homePath?: string
}

export function createPagesSnapshot(input: PagesSnapshot): PagesSnapshot {
  return {
    pages: input.pages,
    subPackages: input.subPackages,
    tabBar: input.tabBar,
    globConfig: input.globConfig,
    homePath: input.homePath,
  }
}
