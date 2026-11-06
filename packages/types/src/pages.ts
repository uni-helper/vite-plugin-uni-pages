import type { PageStyle } from './style'

declare global {
  /**
   * 布局名登记处
   *
   * `@uni-helper/vite-plugin-uni-layouts` 生成的声明文件会把扫描到的布局名填进来，
   * 页面配置里的 `layout` 因此只能写真实存在的名字。没装那个插件时这里为空，
   * `layout` 退回成任意字符串。
   */
  interface UniHelperUniLayouts {}
}

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

  /**
   * 页面使用的布局，必须是 `@uni-helper/vite-plugin-uni-layouts` 扫描到的布局名；
   * `false` 表示不套布局。没装那个插件时接受任意字符串
   *
   * @hidden pages.json 的 schema 生成器读不懂这个条件类型，会把它写成 boolean，
   * 让 `"layout": "posts"` 变成校验错误。生成器支持条件类型之前先不进 schema；
   * schema 不写这个属性时未知字段仍然放行
   */
  layout?: keyof UniHelperUniLayouts extends never ? string | boolean : keyof UniHelperUniLayouts | boolean

  [x: string]: any
}

/**
 * 设置页面路径及窗口表现
 *
 * 文档中为必填，类型上保持可选，插件可由文件扫描自动生成
 */
export type Pages = PageItem[]
