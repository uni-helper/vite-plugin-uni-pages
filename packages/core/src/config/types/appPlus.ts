import type { HEXColor } from './common'

export interface AppPlus {
  /**
   * 窗体背景色。无论vue页面还是nvue页面，在App上都有一个父级原生窗体，该窗体的背景色生效时间快于页面里的css生效时间
   * @default "#FFFFFF"
   * @desc App
   */
  background?: HEXColor

  /**
   * 导航栏 ，详见?:导航栏; 设置为 false 不显示默认导航栏
   * @desc App、H5
   */
  titleNView?: object | false

  /**
   * 原生子窗体，详见?:原生子窗体
   * @desc App 1.9.10+
   */
  subNVues?: object

  /**
   * 页面回弹效果，设置为 "none" 时关闭效果。
   * @desc App-vue（nvue Android无页面级bounce效果，仅list、recycle-list、waterfall等滚动组件有bounce效果）
   */
  bounce?: string

  /**
   * 侧滑返回功能，可选值："close"（启用侧滑返回）、"none"（禁用侧滑返回）
   * @default "close"
   * @desc App-iOS
   */
  popGesture?: string

  /**
   * iOS软键盘上完成工具栏的显示模式，设置为 "none" 时关闭工具栏。
   * @default "auto"
   * @desc App-iOS
   */
  softInputNavBar?: string

  /**
   * 软键盘弹出模式，支持 adjustResize、adjustPan 两种模式
   * @default "adjustPan"
   * @desc App
   */
  softInputMode?: string

  /**
   * 下拉刷新
   * @desc App
   */
  pullToRefresh?: object

  /**
   * 滚动条显示策略，设置为 "none" 时不显示滚动条。
   * @desc App
   */
  scrollIndicator?: string

  /**
   * 窗口显示的动画效果，详见：窗口动画。
   * @default "pop-in"
   * @desc App
   */
  animationType?: string

  /**
   * 窗口显示动画的持续时间，单位为 ms。
   * @default "300"
   * @desc App
   */
  animationDuration?: number

  [x: string]: any
}
