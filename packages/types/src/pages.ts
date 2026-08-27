import type { PageStyle } from './style'

/**
 * @deprecated 请使用 Page
 *
 * pages 数组的元素类型
 */
export interface PageMetaDatum {
  /**
   * 配置页面路径
   */
  path: string

  /**
   * 配置页面窗口表现，配置项参考 [pageStyle](https://uniapp.dcloud.net.cn/collocation/pages#style)
   */
  style?: PageStyle

  /**
   * 当前页面是否需要登录才可以访问，此配置优先级高于 uniIdRouter 下的 needLogin
   *
   * @default false
   */
  needLogin?: boolean

  [x: string]: any
}

/**
 * pages 数组的元素类型
 */
export interface PageItem {
  /**
   * 配置页面路径
   */
  path: string

  /**
   * 配置页面窗口表现，配置项参考 [pageStyle](https://uniapp.dcloud.net.cn/collocation/pages#style)
   */
  style?: PageStyle

  /**
   * 当前页面是否需要登录才可以访问，此配置优先级高于 uniIdRouter 下的 needLogin
   *
   * @default false
   */
  needLogin?: boolean

  [x: string]: any
}

/**
 * 设置页面路径及窗口表现
 *
 * 文档中为必填，类型上保持可选，插件可由文件扫描自动生成
 */
export type Pages = PageItem[]
