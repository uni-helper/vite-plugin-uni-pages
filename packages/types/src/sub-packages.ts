import type { Pages } from './pages'

/**
 * subPackages 数组的元素类型，即应用的子包
 */
export interface SubPackage {
  /**
   * 子包的根目录
   */
  root: string

  /**
   * 是否声明对应分包为独立分包
   *
   * @default false
   *
   * @desc uni-app x
   */
  independent?: boolean

  /**
   * 子包由哪些页面组成，参数同 pages
   */
  pages: Pages

  /**
   * 子包的插件
   */
  plugins?: Record<string, any>

  [x: string]: any
}

/**
 * 分包加载配置，H5 不支持
 */
export type SubPackages = SubPackage[]
