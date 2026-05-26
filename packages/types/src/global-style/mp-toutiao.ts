import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-toutiao 平台的特定样式，配置项参考 <https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/framework/general-configuration#window>
 *
 * 相应的类型是 MpToutiao
 *
 * @desc 抖音小程序
 */
export interface MpToutiao {
  /**
   * 导航栏背景颜色，支持 HEX 颜色
   *
   * @default "#000000"
   *
   * @format color
   */
  navigationBarBackgroundColor?: HEXColor | ThemeVar

  /**
   * 导航栏标题颜色，同时影响标题颜色、右胶囊颜色、左返回箭头颜色
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
   * @default 同 backgroundColor
   */
  backgroundColorTop?: HEXColor | ThemeVar

  /**
   * 底部窗口的背景色，仅 iOS 支持
   *
   * @default 同 backgroundColor
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
   * 仅在 navigationStyle 为 "default" 时生效，用来控制导航栏透明设置
   *
   * "always" 一直透明
   *
   * "auto" 滑动自适应
   *
   * "none" 不透明
   *
   * @default "none"
   */
  transparentTitle?: 'always' | 'auto' | 'none'

  /**
   * 框架骨架屏配置，仅支持配置 config 属性，优先级高于 app.json，详见 [小程序框架骨架屏](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/guide/experience-optimization/list/skeleton)
   *
   * @desc 2.47.0
   */
  skeleton?: {
    /**
     * 包含超时移除及自动生成配置等
     */
    config?: {
      /**
       * 设置骨架屏超时移除时间，单位为 ms，为 0 时关闭超时移除
       *
       * @default 2000
       */
      timeout?: number

      /**
       * 骨架屏显示时的动画
       *
       * @default 'spin'
       */
      loading?: 'spin' | 'chiaroscuro' | 'shine'

      /**
       * 骨架页面中图片块配置
       *
       * @default { shape: 'rect', color: '#efefef' }
       */
      image?: {
        /**
         * 骨架页面中图片块形状
         *
         * circle 圆形
         *
         * rect 矩形
         *
         * @default "rect"
         */
        shape?: 'circle' | 'rect'

        /**
         * 骨架页面中图片块颜色，支持 HEX 颜色
         *
         * @default "#efefef"
         *
         * @format color
         */
        color?: HEXColor

        [x: string]: any
      }

      /**
       * 骨架页面中被视为按钮块的配置
       *
       * @default { color: '#efefef }
       */
      button?: {
        /**
         * 骨架页面中被视为按钮块的颜色，支持 HEX 颜色
         *
         * @default "#efefef"
         *
         * @format color
         */
        color?: HEXColor

        [x: string]: any
      }

      /**
       * 骨架屏背景色，支持 HEX 颜色
       *
       * @default "#fff"
       *
       * @format color
       */
      backgroundColor?: HEXColor

      /**
       * 默认为使用绝对定位占满全屏
       *
       * 当对自定义组件使用，作为局部加载的样式时，可设置为 "auto"，高度随内容高度撑开
       *
       * @default "fullscreen"
       */
      mode?: 'fullscreen' | 'auto'

      /**
       * CSS单位，元素绝对定位都使用 "vw" 与 "vh"
       *
       * @default "vw"
       */
      cssUnit?: 'px' | 'rem' | 'vw' | 'vh' | 'vmin' | 'vmax'

      /**
       * 生成骨架屏页面中 css 值保留的小数点位数，默认为 4
       *
       * @default 4
       */
      decimal?: number

      [x: string]: any
    }

    /**
     * 页面路径同骨架屏文件的对应关系
     */
    page?: Record<string, string>

    [x: string]: any
  }

  [x: string]: any
}
