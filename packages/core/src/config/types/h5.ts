import type { HEXColor } from './common'

export interface H5 {
  /**
   * 背景颜色，颜色值格式为"#RRGGBB"。
   * @default "#F7F7F7"
   * @desc
   */
  backgroundColor?: HEXColor

  /**
   * 自定义按钮，参考 buttons
   * @desc
   */
  buttons?: any[]

  /**
   * 标题文字颜色
   * @default "#000000"
   * @desc
   */
  titleColor?: HEXColor

  /**
   * 标题文字内容
   * @desc
   */
  titleText?: string

  /**
   * 标题文字字体大小
   * @desc
   */
  titleSize?: string

  /**
   * 导航栏样式。"default"-默认样式；"transparent"-透明渐变。
   * @default "default"
   * @desc
   */
  type?: string

  /**
   * 导航栏上的搜索框样式，详见：searchInput
   * @desc 1.6.5
   */
  searchInput?: object

  [x: string]: any
}
