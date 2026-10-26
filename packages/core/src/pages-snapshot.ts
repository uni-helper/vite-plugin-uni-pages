import type { PagesConfig, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { InternalPages } from './types'

/**
 * 一次生成的完整路由快照。
 *
 * 虚拟模块、路由字符串和声明文件都从这里取值。生成过程本身仍可以使用
 * 可变的工作字段；创建快照时复制容器，后续工作字段的增删不会改变本次
 * 结果，便于测试与虚拟模块读取保持一致。
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
    pages: [...input.pages],
    subPackages: [...input.subPackages],
    tabBar: input.tabBar
      ? { ...input.tabBar, list: input.tabBar.list ? [...input.tabBar.list] : undefined }
      : undefined,
    globConfig: input.globConfig,
    homePath: input.homePath,
  }
}
