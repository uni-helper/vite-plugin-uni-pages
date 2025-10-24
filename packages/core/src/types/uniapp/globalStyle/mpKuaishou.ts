import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-kuaishou 平台的特定样式，配置项参考 <https://mp.kuaishou.com/docs/develop/frame/config/conf_appjson.html#window>
 *
 * 相应的类型是 MpKuaishou
 *
 * @desc 快手小程序
 */
export interface MpKuaishou {
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
   * 是否开启全局的下拉刷新，详见 [Page.onPullDownRefresh](https://mp.kuaishou.com/docs/develop/frame/page/page_page.html#onpulldownrefresh)
   *
   * @default false
   */
  enablePullDownRefresh?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位为 px，详见 [Page.onReachBottom](https://mp.kuaishou.com/docs/develop/frame/page/page_page.html#onreachbottom)
   *
   * @default 50
   */
  onReachBottomDistance?: number

  /**
   * 屏幕旋转设置，支持 auto / portrait / landscape，详见 [响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html)
   *
   * "auto" 自动
   *
   * "portrait" 竖屏
   *
   * "landscape" 横屏
   *
   * @default "portrait"
   */
  pageOrientation?: 'auto' | 'portrait' | 'landscape'

  [x: string]: any
}
