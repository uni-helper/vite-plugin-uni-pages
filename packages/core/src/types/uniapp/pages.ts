import type { GlobalStyle } from './globalStyle'

export interface Page {
  /**
   * 配置页面路径
   */
  path: string
  /**
   * 配置页面窗口表现，配置项参考下方 pageStyle
   */
  style?: GlobalStyle
  /**
   * 当前页面是否需要登录才可以访问，此配置优先级高于 uniIdRouter 下的 needLogin
   */
  needLogin?: boolean

  /**
   * 自定义属性
   */
  [key: string]: any
}

export type Pages = Page[]
