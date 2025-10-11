export type RGBColor = `rgb(${number}, ${number}, ${number})`
export type RGBAColor = `rgba(${number}, ${number}, ${number}, ${number})`
export type HEXColor = `#${string}`
export type Color = RGBColor | RGBAColor | HEXColor

export type PxSize = `${number}px`
export type RpxSize = `${number}rpx`
export type PercentageSize = `${number}%`

export type ThemeVar = `@${string}`

/**
 * 窗口动画，详见 [窗口动画](https://uniapp.dcloud.net.cn/api/router.html#animation)
 */
export type AnimationType = 'slide-in-right' | 'slide-in-left' | 'slide-in-top' | 'slide-in-bottom' | 'pop-in' | 'fade-in' | 'zoom-out' | 'zoom-fade-out' | 'none'

export interface TitleNViewButton {
  /**
   * 自定义按钮样式，详见 [自定义按钮样式](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview-buttons-type)
   *
   * "forward" 前进按钮
   *
   * "back" 后退按钮
   *
   * "share" 分享按钮
   *
   * "favorite" 收藏按钮
   *
   * "home" 主页按钮
   *
   * "menu" 菜单按钮
   *
   * "close" 关闭按钮
   *
   * "none" 无样式，需通过 text 属性设置按钮上显示的内容、通过 fontSrc 属性设置使用的字体库
   *
   * @default "none"
   */
  type?: 'forward' | 'back' | 'share' | 'favorite' | 'home' | 'menu' | 'close' | 'none'

  /**
   * 自定义按钮文字颜色，支持 HEX 颜色
   *
   * @default 与标题文字样式一样
   *
   * @format color
   */
  color?: HEXColor

  /**
   * 自定义按钮背景色，仅在标题栏 type 为 "transparent" 时生效，支持 HEX 和 RGBA 颜色
   *
   * @default 灰色半透明
   *
   * @format color
   */
  background?: HEXColor | RGBAColor

  /**
   * 自定义按钮按下状态文字颜色，支持 HEX 和 RGBA 颜色
   *
   * @default color 属性值自动调整透明度为 0.3
   *
   * @format color
   */
  colorPressed?: HEXColor | RGBAColor

  /**
   * 自定义按钮在标题栏的显示位置，仅支持 "right" / "left"
   *
   * "right" 右侧
   *
   * "left" 左侧
   *
   * @default "right"
   */
  float?: 'right' | 'left'

  /**
   * 自定义按钮文字粗细，仅支持 "normal" | "bold"
   *
   * "normal" 标准
   *
   * "bold" 加粗
   *
   * @default "normal"
   */
  fontWeight?: 'normal' | 'bold'

  /**
   * 自定义按钮文字大小
   */
  fontSize?: string

  /**
   * 自定义按钮字体文件路径，只支持本地地址
   */
  fontSrc?: string

  /**
   * 自定义按钮是否显示选择指示图标（向下箭头），常用于城市选择
   *
   * @default false
   */
  select?: boolean

  /**
   * 自定义按钮文字内容。使用字体图标时 unicode 字符表示必须以"\\u" 开头，如 "\\ue123"
   */
  text?: string

  /**
   * 自定义按钮文字宽度，支持单位为 px 的逻辑像素值或 "auto"，按钮内容居中显示
   *
   * @default "44px"
   */
  width?: PxSize | 'auto'
}
