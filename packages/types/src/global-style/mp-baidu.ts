import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-baidu 平台的特定样式，配置项参考 [MP-BAIDU](https://uniapp.dcloud.net.cn/collocation/pages.html#mp-baidu) 和 <https://smartprogram.baidu.com/docs/develop/framework/process/#window>
 *
 * 相应的类型是 MpBaidu
 *
 * @desc 百度小程序
 */
export interface MpBaidu {
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
   * @desc 2.10.34
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

  /**
   * 小程序页面是否禁止响应字体大小的设置
   *
   * "auto" 默认响应
   *
   * "none" 不响应
   *
   * @desc 基础库版本 3.200.1
   *
   * @default "auto"
   */
  textSizeAdjust?: 'auto' | 'none'

  /**
   * 屏幕旋转设置，支持 auto / portrait / landscape
   *
   * "auto" 自动
   *
   * "portrait" 竖屏
   *
   * "landscape" 横屏
   *
   * @desc 基础库版本 3.450.8，web 化暂不支持
   *
   * @default "portrait"
   */
  pageOrientation?: 'auto' | 'portrait' | 'landscape'

  [x: string]: any
}
