import type { HEXColor, PercentageSize, PxSize, RGBAColor, TitleNViewButton } from '../common'

export interface H5 {
  /**
   * 导航栏，详见 [导航栏](https://uniapp.dcloud.net.cn/collocation/pages#h5-titlenview)
   */
  titleNView?: false | {
    /**
     * 背景颜色，支持 HEX 颜色
     *
     * @default "#F7F7F7"
     *
     * @format color
     */
    backgroundColor?: HEXColor

    /**
     * 自定义按钮，详见 [自定义按钮](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview-buttons)
     */
    buttons?: TitleNViewButton[]

    /**
     * 标题文字颜色，支持 HEX 颜色
     *
     * @default "#000000"
     *
     * @format color
     */
    titleColor?: HEXColor

    /**
     * 标题文字内容
     */
    titleText?: string

    /**
     * 标题文字大小
     */
    titleSize?: string

    /**
     * 导航栏样式
     *
     * "default" 默认样式
     *
     * "transparent" 滚动透明渐变
     *
     * @default "default"
     */
    type?: 'default' | 'transparent'

    /**
     * 导航栏上的搜索框配置，详见 [searchInput](https://uniapp.dcloud.net.cn/collocation/pages#h5-searchinput)
     *
     * @desc 1.6.5
     */
    searchInput?: {
      /**
       * 是否自动获取焦点
       *
       * @default false
       */
      autoFocus?: boolean

      /**
       * 非输入状态下文本的对齐方式
       *
       * "left" 居左对齐
       *
       * "right" 居右对齐
       *
       * "center" 居中对齐
       *
       * @default "center"
       */
      align?: 'center' | 'left' | 'right'

      /**
       * 背景颜色，支持 HEX 和 RGBA 颜色
       *
       * @default "rgba(255,255,255,0.5)"
       *
       * @format color
       */
      backgroundColor?: HEXColor | RGBAColor

      /**
       * 输入框的圆角半径，单位为 px
       *
       * @default "0px"
       */
      borderRadius?: PxSize

      /**
       * 提示文本
       */
      placeholder?: string

      /**
       * 提示文本颜色，支持 HEX 颜色
       *
       * @default "#CCCCCC"
       *
       * @format color
       */
      placeholderColor?: HEXColor

      /**
       * 是否禁止输入
       *
       * @default false
       */
      disabled?: boolean

      [x: string]: any
    }

    [x: string]: any
  }

  /**
   * 下拉刷新，详见 [下拉刷新](https://uniapp.dcloud.net.cn/collocation/pages#h5-pulltorefresh)
   */
  pullToRefresh?: {
    /**
     * 下拉刷新控件颜色，支持 HEX 颜色
     *
     * @default "#2BD009"
     */
    color?: HEXColor

    /**
     * 下拉刷新控件起始位置，支持支持单位为 px 的逻辑像素值或百分比
     *
     * @default "0px"
     */
    offset?: PxSize | PercentageSize

    [x: string]: any
  }

  [x: string]: any
}
