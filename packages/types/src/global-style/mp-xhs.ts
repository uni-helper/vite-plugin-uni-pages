import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-xhs 平台的特定样式，配置项参考 <https://miniapp.xiaohongshu.com/doc/DC813994>
 *
 * 相应的类型是 MpXhs
 *
 * @desc 小红书小程序
 */
export interface MpXhs {
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
   * 窗口的背景色，支持 HEX 颜色
   *
   * @default "#FFFFFF"
   */
  backgroundColor?: HEXColor | ThemeVar

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
