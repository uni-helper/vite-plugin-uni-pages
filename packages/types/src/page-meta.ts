import type { GlobalStyle } from './global-style'
import type { TabBarItem } from './tab-bar'

export interface PageMetaDatum {
  /**
   * 配置页面路径
   */
  path: string
  type?: string
  /**
   * 配置页面窗口表现，配置项参考下方 pageStyle
   */
  style?: GlobalStyle
  /**
   * 当前页面是否需要登录才可以访问，此配置优先级高于 uniIdRouter 下的 needLogin
   */
  needLogin?: boolean
  [x: string]: any
}

export type ExcludeIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K]
}

export interface SubPageMetaDatum {
  /**
   * 子包的根目录
   */
  root: string
  /**
   * 子包由哪些页面组成
   */
  pages: PageMetaDatum[]
  /**
   * 子包插件
   */
  plugins?: {
    [pluginName: string]: {
      version: string
      provider: string
      export?: string
      [key: string]: any
    }
  }
}

export interface UserTabBarItem extends Partial<TabBarItem> {
  /**
   * 配置页面路径
   * @deprecated 可选，将会根据文件路径自动生成
   */
  pagePath?: string

  /**
   * 排序，数字越小越靠前
   */
  index?: number
}

export interface UserPageMeta extends Partial<PageMetaDatum> {
  /**
   * 配置页面路径
   * @deprecated 可选，将会根据文件路径自动生成
   */
  path?: string

  /**
   * 底部 tabBar 的子项 [tabBar](https://uniapp.dcloud.net.cn/collocation/pages#tabBar)
   */
  tabBar?: UserTabBarItem
}

export type MaybePromise<T> = T | Promise<T>
export type MaybeCallable<T> = T | (() => T)
export type MaybePromiseCallable<T> = T | (() => T) | (() => Promise<T>)

export declare function definePage(options: MaybePromiseCallable<UserPageMeta>): void

export type DefinePage = typeof definePage
