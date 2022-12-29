import type { HEXColor } from './common'

export interface AppPlus {
  /**
   * 窗体背景色。无论vue页面还是nvue页面，在App上都有一个父级原生窗体，该窗体的背景色生效时间快于页面里的css生效时间
   * @type HEXColor
   * @default "#FFFFFF"
   * @desc App
   */
  background: HEXColor

  /**
   * 导航栏 ，详见:导航栏
   * @type Object
   * @desc App、H5
   */
  titleNView: object

  /**
   * 原生子窗体，详见:原生子窗体
   * @type Object
   * @desc App 1.9.10+
   */
  subNVues: object

  /**
   * 页面回弹效果，设置为 "none" 时关闭效果。
   * @type String
   * @desc App-vue（nvue Android无页面级bounce效果，仅list、recycle-list、waterfall等滚动组件有bounce效果）
   */
  bounce: string

  /**
   * 侧滑返回功能，可选值："close"（启用侧滑返回）、"none"（禁用侧滑返回）
   * @type String
   * @default "close"
   * @desc App-iOS
   */
  popGesture: string

  /**
   * iOS软键盘上完成工具栏的显示模式，设置为 "none" 时关闭工具栏。
   * @type String
   * @default "auto"
   * @desc App-iOS
   */
  softInputNavBar: string

  /**
   * 软键盘弹出模式，支持 adjustResize、adjustPan 两种模式
   * @type String
   * @default "adjustPan"
   * @desc App
   */
  softInputMode: string

  /**
   * 下拉刷新
   * @type Object
   * @desc App
   */
  pullToRefresh: object

  /**
   * 滚动条显示策略，设置为 "none" 时不显示滚动条。
   * @type String
   * @desc App
   */
  scrollIndicator: string

  /**
   * 窗口显示的动画效果，详见：窗口动画。
   * @type String
   * @default "pop-in"
   * @desc App
   */
  animationType: string

  /**
   * 窗口显示动画的持续时间，单位为 ms。
   * @type Number
   * @default "300"
   * @desc App
   */
  animationDuration: number

  [x: string]: any
}
