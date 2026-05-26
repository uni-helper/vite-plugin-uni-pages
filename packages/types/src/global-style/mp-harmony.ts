import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-harmony 平台的特定样式，配置项参考 <https://developer.huawei.com/consumer/cn/doc/SPPartnerCenter-develop-Guides/extjson-description-0000002554249601>
 *
 * 相应的类型是 MpHarmony
 *
 * @desc 鸿蒙元服务
 */
export interface MpHarmony {
  /**
   * 导航栏背景颜色，支持 HEX 颜色
   *
   * @default "#000000"
   *
   * @format color
   */
  navigationBarBackgroundColor?: HEXColor | ThemeVar

  /**
   * 导航栏标题、状态栏颜色
   *
   * @default "white"
   */
  navigationBarTextStyle?: 'black' | 'white' | ThemeVar

  /**
   * 导航栏标题文字内容
   */
  navigationBarTitleText?: string

  /**
   * 窗口的背景色，支持 HEX 颜色
   *
   * @default "#FFFFFF"
   */
  backgroundColor?: HEXColor | ThemeVar

  /**
   * 下拉 loading 的样式，仅支持 "dark" / "light"
   *
   * @default "dark"
   */
  backgroundTextStyle?: 'dark' | 'light' | ThemeVar

  /**
   * 是否开启全局的下拉刷新
   *
   * @default false
   */
  enablePullDownRefresh?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位为 px
   *
   * @default 50
   */
  onReachBottomDistance?: number

  [x: string]: any
}
