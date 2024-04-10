import type { HEXColor, ThemeVar } from './common'

export interface TabBarIconFont {
  /**
   * 字库 Unicode 码
   */
  text?: string

  /**
   * 选中后字库 Unicode 码
   */
  selectedText?: string

  /**
   * 字体图标字号，单位为 px
   */
  fontSize?: string

  /**
   * 字体图标颜色
   */
  color?: HEXColor

  /**
   * 字体图标选中颜色
   */
  selectedColor?: HEXColor

  [x: string]: any
}

export interface TabBarItem {
  /**
   * 页面路径，必须在 pages 中先定义
   */
  pagePath: string

  /**
   * tab 上按钮文字，在 App 和 H5 平台为非必填，例如中间可放一个没有文字的 + 号图标
   */
  text?: string

  /**
   * 图片路径，icon 大小限制为 40 kb，建议尺寸为 81px * 81px
   *
   * 当 position 为 "top" 时，此参数无效
   *
   * 不支持网络图片，不支持字体图标
   */
  iconPath?: string | ThemeVar

  /**
   * 选中时的图片路径，icon 大小限制为 40 kb，建议尺寸为 81px * 81px
   *
   * 当 position 为 "top" 时，此参数无效
   *
   * 不支持网络图片，不支持字体图标
   */
  selectedIconPath?: string | ThemeVar

  /**
   * 该项是否显示，默认显示
   *
   * @desc App (3.2.10+)、H5 (3.2.10+)
   */
  visible?: boolean

  /**
   * 字体图标，优先级高于 iconPath
   *
   * @desc App（3.4.4+）、H5 (3.5.3+)
   */
  iconfont?: TabBarIconFont

  [x: string]: any
}

export interface TabBarMidButton {
  /**
   * 中间按钮的宽度，tabBar 其它项为减去此宽度后平分，默认值为与其它项平分宽度
   *
   * @default "80px"
   */
  width?: string

  /**
   * 中间按钮的高度，可以大于 tabBar 高度，达到中间凸起的效果
   *
   * @default "50px"
   */
  height?: string

  /**
   * 中间按钮的文字
   */
  text?: string

  /**
   * 中间按钮的图片路径
   */
  iconPath?: string

  /**
   * 图片宽度（高度等比例缩放）
   *
   * @default "24px"
   */
  iconWidth?: string

  /**
   * 中间按钮的背景图片路径
   */
  backgroundImage?: string

  /**
   * 字体图标，优先级高于 iconPath
   *
   * @desc App (3.4.4+)
   */
  iconfont?: TabBarIconFont

  [x: string]: any
}

export interface TabBar {
  /**
   * tab 上的文字默认颜色
   *
   * @format color
   */
  color: HEXColor | ThemeVar

  /**
   * tab 上的文字选中时的颜色
   *
   * @format color
   */
  selectedColor: HEXColor | ThemeVar

  /**
   * tab 的背景色
   *
   * @format color
   */
  backgroundColor?: HEXColor | ThemeVar

  /**
   * tabBar 上边框的颜色
   *
   * @default "black"
   *
   * @desc App 2.3.4+、H5 3.0.0+
   *
   * @format color
   */
  borderStyle?: 'black' | 'white' | HEXColor | ThemeVar

  /**
   * iOS 高斯模糊效果，参考 [使用说明](https://ask.dcloud.net.cn/article/36617)
   *
   * @default "none"
   *
   * @desc App 2.4.0+、H5 3.0.0+（只有最新版浏览器才支持）
   */
  blurEffect?: 'dark' | 'extralight' | 'light' | 'none'

  /**
   * tab 列表，最少 2个，最多 5 个
   *
   * @type {TabBarItem[]}
   */
  list: [TabBarItem, TabBarItem, TabBarItem?, TabBarItem?, TabBarItem?]

  /**
   * tab 位置
   *
   * @default "bottom"
   *
   * @desc "top" 仅微信小程序支持
   */
  position?: 'bottom' | 'top'

  /**
   * 文字默认大小
   *
   * @default "10px"
   *
   * @desc App 2.3.4+、H5 3.0.0+
   */
  fontSize?: string

  /**
   * 图标默认宽度（高度等比例缩放）
   *
   * @default "24px"
   *
   * @desc App 2.3.4+、H5 3.0.0+
   */
  iconWidth?: string

  /**
   * 图标和文字的间距
   *
   * @default "3px"
   *
   * @desc App 2.3.4+、H5 3.0.0+
   */
  spacing?: string

  /**
   * tabBar 默认高度
   *
   * @default "50px"
   *
   * @desc App 2.3.4+、H5 3.0.0+
   */
  height?: string

  /**
   * 中间按钮 仅在 list 项为偶数时有效
   *
   * @desc App 2.3.4+、H5 3.0.0+
   */
  midButton?: TabBarMidButton

  /**
   * list 设置 iconfont 属性时，需要指定字体文件路径
   *
   * @desc App 3.4.4+、H5 3.5.3+
   */
  iconfontSrc?: string

  /**
   * 设置背景图片，优先级高于 backgroundColor
   */
  backgroundImage?: string

  /**
   * 设置标题栏的背景图平铺方式
   *
   * "repeat" 背景图片在垂直方向和水平方向平铺
   *
   * "repeat-x" 背景图片在水平方向平铺，垂直方向拉伸
   *
   * "repeat-y" 背景图片在垂直方向平铺，水平方向拉伸
   *
   * "no-repeat" 背景图片在垂直方向和水平方向都拉伸
   *
   * @default "no-repeat"
   */
  backgroundRepeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'

  /**
   * tabBar上红点颜色
   *
   * @format color
   */
  redDotColor?: string

  [x: string]: any
}
