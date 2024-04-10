import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-jd 平台的特定样式，配置项参考 <https://mp-docs.jd.com/doc/dev/framework/504#heading-3>
 *
 * 相应的类型是 MpJd
 *
 * @desc 京东小程序
 */
export interface MpJd {
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
   * 导航栏样式
   *
   * "default" 默认样式
   *
   * "custom" 自定义导航栏，只保留右上角胶囊按钮
   *
   * @default "default"
   */
  navigationStyle?: 'default' | 'custom'

  /**
   * 下拉窗口的背景色，不是页面的背景颜色
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
   * 顶部窗口的背景色，仅 iOS 支持
   *
   * @default "#FFFFFF"
   */
  backgroundColorTop?: HEXColor | ThemeVar

  /**
   * 底部窗口的背景色，仅 iOS 支持
   *
   * @default "#FFFFFF"
   */
  backgroundColorBottom?: HEXColor | ThemeVar

  /**
   * 是否开启全局的下拉刷新，详见 [Page.onPullDownRefresh](https://mp-docs.jd.com/doc/dev/framework/520#heading-10)
   *
   * @default false
   */
  enablePullDownRefresh?: boolean

  [x: string]: any
}
