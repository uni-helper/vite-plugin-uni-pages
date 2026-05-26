import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-lark 平台的特定样式，配置项参考 <https://open.feishu.cn/document/client-docs/gadget/introduction/global-settings#a172b7dd>
 *
 * 相应的类型是 MpLark
 *
 * @desc 飞书小程序
 */
export interface MpLark {
  /**
   * 导航栏背景颜色，支持 HEX 颜色
   *
   * @desc iOS, Android
   *
   * @default "#000000"
   *
   * @format color
   */
  navigationBarBackgroundColor?: HEXColor | ThemeVar

  /**
   * 导航栏标题、状态栏颜色
   *
   * @desc iOS, Android
   *
   * @default "white"
   */
  navigationBarTextStyle?: 'black' | 'white' | ThemeVar

  /**
   * 导航栏标题文字内容
   *
   * @desc iOS, Android, PC
   */
  navigationBarTitleText?: string

  /**
   * 导航栏透明设置
   *
   * "always" 一直透明
   *
   * "auto" 滑动自适应
   *
   * "none" 不透明
   *
   * @desc iOS, Android
   *
   * @default "none"
   */
  transparentTitle?: 'always' | 'auto' | 'none'

  /**
   * 导航栏样式
   *
   * "default" 默认样式
   *
   * "custom" 自定义导航栏，只保留右上角胶囊按钮
   *
   * @desc iOS, Android, PC
   *
   * @default "default"
   */
  navigationStyle?: 'default' | 'custom'

  /**
   * 窗口的背景色，支持 HEX 颜色
   *
   * @desc iOS, Android, PC(3.14.0+)
   *
   * @default "#FFFFFF"
   */
  backgroundColor?: HEXColor | ThemeVar

  /**
   * 下拉 loading 的样式，仅支持 "dark" / "light"
   *
   * @desc iOS, Android
   *
   * @default "dark"
   */
  backgroundTextStyle?: 'dark' | 'light' | ThemeVar

  /**
   * 顶部窗口的背景色
   *
   * @desc iOS
   *
   * @default "#FFFFFF"
   */
  backgroundColorTop?: HEXColor | ThemeVar

  /**
   * 底部窗口的背景色
   *
   * @desc iOS
   *
   * @default "#FFFFFF"
   */
  backgroundColorBottom?: HEXColor | ThemeVar

  /**
   * 是否开启全局的下拉刷新
   *
   * @desc iOS, Android
   *
   * @default false
   */
  enablePullDownRefresh?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位为 px
   *
   * @desc iOS, Android
   *
   * @default 50
   */
  onReachBottomDistance?: number

  /**
   * PCMode 模式下特定的窗口配置，支持的属性与通用 window 配置属性一致，仅当在 ext 内配置了 defaultPages.PCMode 时生效
   */
  PCMode?: Omit<MpLark, 'PCMode'>

  [x: string]: any
}
