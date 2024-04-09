import type { AnimationType, HEXColor, PercentageSize, PxSize, RGBAColor, TitleNViewButton } from '../common'

export interface AppPlus {
  /**
   * 窗体背景色，支持 HEX 颜色
   *
   * 无论 vue 页面还是 nvue 页面，在 App 上都有一个父级原生窗体，该窗体的背景色生效时间快于页面里的 css 生效时间
   *
   * @default "#FFFFFF"
   *
   * @desc App (vue 页面需要将 body 背景色设为透明)
   *
   * @format color
   */
  background?: HEXColor

  /**
   * 导航栏，详见 [导航栏](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview)
   *
   * 当 navigationStyle 设为 "custom" 或 titleNView 设为 false时，原生导航栏不显示，详见 [自定义导航栏使用注意](https://uniapp.dcloud.net.cn/collocation/pages#customnav)
   */
  titleNView?: false | {
    /**
     * 背景颜色，支持 HEX 和 RGBA 颜色，App 端仅悬浮导航栏支持 RGBA 颜色
     *
     * @default "#F7F7F7"
     *
     * @format color
     */
    backgroundColor?: HEXColor | RGBAColor

    /**
     * 自定义按钮，详见 [自定义按钮](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview-buttons)
     *
     * @desc 纯 nvue 即 render:native 时暂不支持
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
     * 标题文字超出显示区域时处理方式
     *
     * "ellipsis" 超出显示区域时尾部显示省略标记（...）
     *
     * "clip" 超出显示区域时内容裁剪
     *
     * @default "ellipsis"
     */
    titleOverflow?: 'ellipsis' | 'clip'

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
     * "float" 悬浮导航栏
     *
     * @default "default"
     */
    type?: 'default' | 'transparent' | 'float'

    /**
     * 原生 View 增强，详见 [5+ View 控件](http://www.html5plus.org/doc/zh_cn/nativeobj.html#plus.nativeObj.ViewDrawTagStyles)
     */
    tags?: {
      /**
       * 绘制操作标识
       *
       * 可通过 view 对象的 drawBitmap / drawRect / drawText / clearRect 方法进行更新
       */
      id?: string

      /**
       * 绘制操作类型
       *
       * "img" 绘制图片，与 drawBitmap 操作一致，此时 id、src、position、sprite 属性值有效
       *
       * "rect" 绘制矩形区域，与 drawRect 操作一致，此时 id、color、position、rectStyles 属性值有效
       *
       * "font" 绘制文本内容，与 drawText 操作一致，此时 id、position、text、textStyles 属性值有效
       *
       * "richtext" 绘制富文本内容，与 drawRichText 操作一致，此时 id、position、text、richTextStyles 属性值有效
       *
       * "input" 绘制输入框内容，此时 id、position、inputStyles 属性值有效
       */
      tag?: 'img' | 'rect' | 'font' | 'richtext' | 'input'

      /**
       * 矩形区域颜色，支持 HEX 和 RGBA 颜色
       *
       * 不推荐使用，推荐使用 rectStyles
       *
       * 当 tag 属性值为 "rect" 时有效，用于指定矩形区域颜色
       *
       * @default "#FFFFFF"
       *
       * @format color
       */
      color?: HEXColor | RGBAColor

      /**
       * 绘制输入框的样式
       *
       * 当 tag 属性值为 "input" 时有效，用于指定绘制输入框的样式、大小位置等信息
       */
      inputStyles?: {
        /**
         * 输入框类型
         *
         * "email" 邮箱地址输入框
         *
         * "number" 数字输入框
         *
         * "search" 搜索文本输入框
         *
         * "tel" 电话号码输入框
         *
         * "text" 普通文本输入框
         *
         * "url" URL地址输入框
         *
         * @default "text"
         */
        type?: 'email' | 'number' | 'search' | 'tel' | 'text' | 'url'

        /**
         * 输入框的提示文本
         *
         * 当用户未输入内容时显示在编辑框中（灰色文字）。
         */
        placeholder?: string

        /**
         * 输入框的字体大小，单位为 px
         *
         * @default "16px"
         */
        fontSize?: PxSize

        /**
         * 输入框的边框颜色，支持 HEX 颜色
         *
         * @default "#000000"
         *
         * @format color
         */
        borderColor?: HEXColor

        /**
         * 输入框的边框圆角半径，单位为 px
         *
         * @default "0px"
         */
        borderRadius?: PxSize

        /**
         * 输入框的边框宽度，单位为 px
         *
         * @default "1px"
         */
        borderWidth?: PxSize

        [x: string]: any
      }

      /**
       * 绘制内容区域，相对于 View 控件的区域信息
       *
       * 当 tag 属性值为 "img" 时，用于指定绘制图片的目标区域
       *
       * 当 tag 属性值为 "rect" 时，用于指定绘制的矩形区域
       *
       * 当 tag 属性值为 "font" 时，用于指定绘制文本的目标区域，此时 height 属性值支持设置为 "wrap_content"，表示文本高度根据内容自动计算，此时通过 top 来定位文本绘制的起始位置
       *
       * @default { top: '0px', left: '0px', width: '100%', height: '100%' }
       */
      position?: {
        /**
         * 区域顶部相对于作用对象或容器向下的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * @default "0px"
         */
        top?: PxSize | PercentageSize | 'auto'

        /**
         * 区域顶部相对于作用对象或容器向右的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * @default "0px"
         */
        left?: PxSize | PercentageSize | 'auto'

        /**
         * 区域宽度，相对于作用对象或容器的宽度，支持单位为 px 的逻辑像素值或百分比
         *
         * @default "100%"
         */
        width?: PxSize | PercentageSize

        /**
         * 区域高度，相对于作用对象或容器的高度，支持单位为 px 的逻辑像素值或百分比
         *
         * @default "100%"
         */
        height?: PxSize | PercentageSize

        /**
         * 区域顶部相对于作用对象或容器向上的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * 当设置了 top 和 height 值时，忽略此属性值
         *
         * 当未设置 top 值时，可通过 bottom 属性值来确定区域的垂直位置
         *
         * 当未设置 height 值时，可通过 top 和 bottom 属性值来确定区域的高度
         */
        bottom?: PxSize | PercentageSize | 'auto'

        /**
         * 区域顶部相对于作用对象或容器向左的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * 当设置了 left 和 width 值时，忽略此属性值
         *
         * 当未设置 left 值时，可通过 right 属性值来确定区域的水平位置
         *
         * 当未设置 width 值时，可通过 left 和 right 属性值来确定区域的宽度
         */
        right?: PxSize | PercentageSize | 'auto'

        [x: string]: any
      }

      /**
       * 绘制区域的样式
       *
       * 当 tag 属性值为 "rect" 时有效，用于指定绘制区域的样式、填充颜色、圆角大小等信息
       */
      rectStyles?: {
        /**
         * 绘制颜色，矩形填充区域的颜色，支持 HEX 和 RGBA 颜色
         *
         * @default "#FFFFFF"
         *
         * @format color
         */
        color?: HEXColor | RGBAColor

        /**
         * 矩形区域的圆角半径，单位为 px
         *
         * @default "0px"
         */
        radius?: PxSize

        /**
         * 矩形边框颜色，绘制矩形边框的颜色，支持 HEX 和 RGBA 颜色
         *
         * @default color 属性值
         *
         * @format color
         */
        borderColor?: HEXColor | RGBAColor

        /**
         * 矩形边框宽度，单位为 px
         *
         * @default "0px"
         */
        borderWidth?: PxSize

        [x: string]: any
      }

      /**
       * 绘制的图片资源
       *
       * 当 tag 属性值为 "img" 时有效，可以是图片资源路径（字符串类型）或者图片对象（plus.nativeObj.Bitmap对象）
       *
       * src 路径支持 gif 图片，设置的图片路径文件使用 ".gif" 后缀时则认为是 gif 图片，如"_www/loading.gif"
       */
      src?: string

      /**
       * 图片源的绘制区域
       *
       * 当 tag 属性值为 "img" 时有效，用于指定图片源的绘制区域，相对于图片的区域信息
       *
       * @default { top: '0px', left: '0px', width: '100%', height: '100%' }
       */
      sprite?: {
        /**
         * 区域顶部相对于作用对象或容器向下的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * @default "0px"
         */
        top?: PxSize | PercentageSize | 'auto'

        /**
         * 区域顶部相对于作用对象或容器向右的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * @default "0px"
         */
        left?: PxSize | PercentageSize | 'auto'

        /**
         * 区域宽度，相对于作用对象或容器的宽度，支持单位为 px 的逻辑像素值或百分比
         *
         * @default "100%"
         */
        width?: PxSize | PercentageSize

        /**
         * 区域高度，相对于作用对象或容器的高度，支持单位为 px 的逻辑像素值或百分比
         *
         * @default "100%"
         */
        height?: PxSize | PercentageSize

        /**
         * 区域顶部相对于作用对象或容器向上的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * 当设置了 top 和 height 值时，忽略此属性值
         *
         * 当未设置 top 值时，可通过 bottom 属性值来确定区域的垂直位置
         *
         * 当未设置 height 值时，可通过 top 和 bottom 属性值来确定区域的高度
         */
        bottom?: PxSize | PercentageSize | 'auto'

        /**
         * 区域顶部相对于作用对象或容器向左的偏移量，支持单位为 px 的逻辑像素值、百分比（相对于作用对象或容器的高度）或 "auto"
         *
         * 当设置了 left 和 width 值时，忽略此属性值
         *
         * 当未设置 left 值时，可通过 right 属性值来确定区域的水平位置
         *
         * 当未设置 width 值时，可通过 left 和 right 属性值来确定区域的宽度
         */
        right?: PxSize | PercentageSize | 'auto'

        [x: string]: any
      }

      /**
       * 绘制的文本内容
       *
       * 当 tag 属性值为 "font" 时有效，用于保存绘制的文本内容
       */
      text?: string

      /**
       * 绘制文本的样式
       *
       * 当 tag 属性值为 "font" 时有效，用于指定绘制文本内容的字体大小、字体颜色、字体类型等信息
       */
      textStyles?: {
        /**
         * 水平对齐方式
         *
         * "left" 字体在指定的区域中水平居左对齐
         *
         * "center" 字体在指定的区域中水平居中对齐
         *
         * "right" 字体在指定的区域中水平居右对齐
         *
         * @default "center"
         */
        align?: 'left' | 'right' | 'center'

        /**
         * 字体颜色，支持 HEX 和 RGBA 颜色
         *
         * @default "#000000"
         *
         * @format color
         */
        color?: HEXColor | RGBAColor

        /**
         * 文本装饰
         *
         * "none" 无装饰效果
         *
         * "underline" 文本带下划线效果
         *
         * "line-through" 文本带贯穿线（删除线）效果
         *
         * @default "none"
         */
        decoration?: 'none' | 'underline' | 'line-through'

        /**
         * 字体名称，如果指定名称的字体不存在，则使用默认字体
         */
        family?: string

        /**
         * 字体文件路径
         */
        fontSrc?: string

        /**
         * 文本行间距，支持单位为 px 的逻辑像素值或百分比
         *
         * @default "20%"
         */
        lineSpacing?: PxSize | PercentageSize

        /**
         * 文本间距，用于设置字体在绘制目标区域四个方向（top / right / bottom / left）的边距，支持单位为 px 的逻辑像素值或百分比（相对于绘制目标区域）
         *
         * @default "0px"
         */
        margin?: string

        /**
         * 文本内容超出显示区域时处理方式
         *
         * "clip" 超出显示区域时内容裁剪
         *
         * "ellipsis" 超出显示区域时尾部显示省略标记（...）
         *
         * @default "clip"
         */
        overflow?: 'clip' | 'ellipsis'

        /**
         * 字体大小，单位为 px
         *
         * @default "16px"
         */
        size?: PxSize

        /**
         * 字体样式
         *
         * "normal" 正常样式
         *
         * "italic" 斜体样式
         *
         * @default "normal"
         */
        style?: 'normal' | 'italic'

        /**
         * 垂直对齐方式，文本内容在指定绘制区域中的垂直对齐方式
         *
         * "top" 垂直居顶对齐
         *
         * "middle" 垂直居中对齐
         *
         * "bottom" - 垂直居底对齐
         *
         * @default "middle"
         */
        verticalAlign?: 'top' | 'middle' | 'bottom'

        /**
         * 字体粗细
         *
         * "normal" 正常
         *
         * "bold" 粗体
         *
         * @default "normal"
         */
        weight?: 'normal' | 'bold'

        /**
         * 文本换行模式
         *
         * "nowrap" 不换行，将所有文本在一行中绘制，忽略换行符("\n")
         *
         * "normal" 自动换行，当指定的宽度无法绘制所有文本时自动换行绘制，碰到 "\n" 字符时强制换行
         *
         * @default "nowrap"
         */
        whiteSpace?: 'normal' | 'nowrap'

        [x: string]: any
      }

      /**
       * 绘制富文本的样式
       *
       * 当 tag 属性值为 "richtext" 时有效，用于指定绘制富文本内容的默认字体颜色、字体类型等信息
       */
      richTextStyles?: {
        /**
         * 富文本内容的水平对齐方式，对整体内容有效，无法单独控制每行的内容
         *
         * "left" 字体在指定的区域中水平居左对齐
         *
         * "center" 字体在指定的区域中水平居中对齐
         *
         * "right" 字体在指定的区域中水平居右对齐
         *
         * @default "left"
         */
        align?: 'left' | 'right' | 'center'

        /**
         * 富文本默认使用的字体名称，如果指定名称的字体不存在，则使用默认字体
         */
        family?: string

        /**
         * 富文本默认使用的字体文件路径，必须为本地路径，如果指定的文件路径无效，则使用系统默认字体
         */
        fontSrc?: string

        [x: string]: any
      }

      [x: string]: any
    }[]

    /**
     * 原生导航栏上的搜索框配置，详见 [searchInput](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview-searchinput)
     *
     * @desc 1.6.0
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

    /**
     * 标题栏控件是否显示 Home 按钮
     *
     * @default false
     */
    homeButton?: boolean

    /**
     * 标题栏控件是否显示左侧返回按钮
     *
     * @desc App 2.6.3+
     *
     * @default true
     */
    autoBackButton?: boolean

    /**
     * 返回按钮的样式，详见 [backButton](https://uniapp.dcloud.net.cn/collocation/pages#app-titlenview-backbuttonstyles)
     *
     * @desc App 2.6.3
     */
    backButton?: {
      /**
       * 背景颜色，仅在标题栏 type 为 "transparent" 时生效，当标题栏透明时按钮显示的背景颜色，支持 HEX 和 RGBA 颜色
       *
       * @default 灰色半透明
       *
       * @format color
       */
      background?: HEXColor | RGBAColor

      /**
       * 角标文本，最多显示3个字符，超过则显示为 ...
       */
      badgeText?: string

      /**
       * 图标和标题颜色，支持 HEX 和 RGBA 颜色
       *
       * @default 窗口标题栏控件的标题文字颜色
       *
       * @format color
       */
      color?: HEXColor | RGBAColor

      /**
       * 按下状态按钮文字颜色，支持 HEX 和 RGBA 颜色
       *
       * @default color 属性值自动调整透明度为 0.3
       *
       * @format color
       */
      colorPressed?: HEXColor | RGBAColor

      /**
       * 返回图标的粗细
       *
       * "normal" 正常
       *
       * "bold" 粗体
       *
       * @default "normal"
       */
      fontWeight?: 'normal' | 'bold'

      /**
       * 返回图标文字大小，单位为 px
       *
       * 窗口标题栏为透明样式 type 为 "transparent" 时，默认值为 "22px"
       *
       * 窗口标题栏为默认样式 type 为 "default" 时，默认值为 "27px"
       */
      fontSize?: PxSize

      /**
       * 是否显示红点，当设置了角标文本时红点不显示
       *
       * @default false
       */
      redDot?: boolean

      /**
       * 返回按钮上的标题，显示在返回图标（字体图标）后
       *
       * @default ""
       */
      title?: string

      /**
       * 返回按钮上标题的粗细
       *
       * "normal" 正常
       *
       * "bold" 粗体
       */
      titleWeight?: 'normal' | 'bold'

      [x: string]: any
    }

    /**
     * 背景图片
     *
     * 背景图片路径，如 "/static/img.png"，仅支持本地文件绝对路径，根据实际标题栏宽高拉伸绘制
     *
     * 渐变色，仅支持线性渐变，两种颜色的渐变，如 "linear-gradient(to top, #a80077, #66ff00)"，其中第一个参数为渐变方向，可选 "to right"（从左向右渐变）/ "to left"（从右向左渐变）/ "to bottom"（从上到下渐变）/ "to top"（从下到上渐变）/ "to bottom right"（从左上到右下渐变）/"to top left"（从左上到右下渐变）
     */
    backgroundImage?: string

    /**
     * 仅在 backgroundImage 设置为图片路径时有效
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
    backgroundRepeat?: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'

    /**
     * 文本对齐方式
     *
     * "center" 居中对齐
     *
     * "left" 居左对齐
     *
     * "auto" 根据平台自动选择（Android 平台居左对齐，iOS 平台居中对齐）
     *
     * @default "auto"
     */
    titleAlign?: 'auto' | 'center' | 'left'

    /**
     * 高斯模糊效果，仅在 type 为 "transparent" 或 "float" 时有效
     *
     * 使用模糊效果时应避免设置背景颜色，设置背景颜色可能覆盖模糊效果
     *
     * "dark" 暗风格模糊，对应 iOS 原生 UIBlurEffectStyleDark 效果
     *
     * "extralight" 高亮风格模糊，对应 iOS 原生 UIBlurEffectStyleExtraLight 效果
     *
     * "light" 亮风格模糊，对应 iOS 原生 UIBlurEffectStyleLight 效果
     *
     * "none" 无模糊效果
     *
     * @default "none"
     */
    blurEffect?: 'dark' | 'extralight' | 'light' | 'none'

    /**
     * 标题栏控件变化作用范围，仅在 type 为 "transparent" 时有效，页面滚动时标题栏背景透明度将发生变化
     *
     * 当页面滚动到指定偏移量时标题栏背景变为完全不透明
     *
     * 支持单位为 px 的逻辑像素值、百分比
     *
     * @default "132px"
     */
    coverage?: PxSize | PercentageSize

    /**
     * 是否显示标题栏的底部分割线
     *
     * @desc 2.6.6
     *
     * @default false
     */
    splitLine?: boolean | {
      /**
       * 底部分割线颜色，支持 HEX 和 RGBA 颜色
       *
       * @default "#CCCCCC"
       *
       * @format color
       */
      color?: HEXColor | RGBAColor

      /**
       * 底部分割线高度，支持单位为 px 的逻辑像素值、百分比
       *
       * @default "1px"
       */
      height?: PxSize | PercentageSize

      [x: string]: any
    }

    /**
     * 副标题文字颜色，支持 HEX 和 RGBA 颜色
     *
     * @desc 2.6.6
     *
     * @default 与主标题文字颜色一致
     *
     * @format color
     */
    subtitleColor?: HEXColor | RGBAColor

    /**
     * 副标题文字字体大小，单位为 px
     *
     * "auto" 自动计算，约为 12px
     *
     * @desc 2.6.6
     *
     * @default "auto"
     */
    subtitleSize?: PxSize | 'auto'

    /**
     * 标题文字超出显示区域时处理方式
     *
     * "clip" 超出显示区域时内容裁剪
     *
     * "ellipsis" 超出显示区域时尾部显示省略标记（...）
     *
     * @desc 2.6.6
     *
     * @default "ellipsis"
     */
    subtitleOverflow?: 'clip' | 'ellipsis'

    /**
     * 副标题文字内容，设置副标题后将显示两行标题，副标题显示在主标题（titleText）下方
     *
     * 设置副标题后将居左显示
     *
     * @desc 2.6.6
     */
    subtitleText?: string

    /**
     * 标题图标，图标路径如 "./img/t.png"，仅支持本地文件路径，相对路径，相对于当前页面的 host 位置，固定宽高为逻辑像素值 "34px"
     *
     * 图片的宽高需要相同
     *
     * 设置标题图标后标题将居左显示
     *
     * @desc 2.6.6
     */
    titleIcon?: string

    /**
     * 标题图标圆角，单位为 px
     *
     * @default "0px"
     */
    titleIconRadius?: PxSize

    [x: string]: any
  }

  /**
   * 原生子窗体，详见 [原生子窗体](https://uniapp.dcloud.net.cn/collocation/pages#app-subNVues)
   *
   * @desc App 1.9.10+
   */
  subNVues?: {
    /**
     * 原生子窗体的标识
     */
    id?: string

    /**
     * 配置 nvue 文件路径，nvue 文件需放置到使用 subNVue 的页面文件目录下，cli 项目需要去掉 .nvue 后缀，只保留文件名
     */
    path?: string

    /**
     * 原生子窗口内置样式
     *
     * "popup" 弹出层
     *
     * "navigationBar" 导航栏
     */
    type?: string

    /**
     * 原生子窗体的样式
     */
    style?: {
      /**
       * 原生子窗体的排版位置，排版位置决定原生子窗体在父窗口中的定位方式
       *
       * "static" 原生子窗体在页面中正常定位，如果页面存在滚动条则随窗口内容滚动
       *
       * "absolute" 原生子窗体在页面中绝对定位，如果页面存在滚动条不随窗口内容滚动
       *
       * "dock" 原生子窗体在页面中停靠，停靠位置由 dock 属性值决定
       *
       * @default "absolute"
       */
      position?: 'static' | 'absolute' | 'dock'

      /**
       * 原生子窗体停靠位置，仅 position 为 "dock" 时生效
       *
       * "top" 原生子窗体停靠在页面顶部
       *
       * "bottom" 原生子窗体停靠在页面底部
       *
       * "right" 原生子窗体停靠在页面右侧
       *
       * "left" 原生子窗体停靠在页面左侧
       *
       * @default "bottom"
       */
      dock?: 'top' | 'bottom' | 'right' | 'left'

      /**
       * 原生子窗体的遮罩层，仅当原生子窗体 type 为 "popup" 时生效，支持 RGBA 颜色
       *
       * @default "rgba(0,0,0,0.5)"
       *
       * @format color
       */
      mask?: RGBAColor

      /**
       * 原生子窗体的宽度，支持以 px 为单位的逻辑像素值或百分比
       *
       * 未设置时，可同时设置 left 和 right 属性值改变窗口的默认宽度
       *
       * @default "100%"
       */
      width?: PxSize | PercentageSize

      /**
       * 原生子窗体的高度，支持以 px 为单位的逻辑像素值或百分比
       *
       * 未设置时，可同时设置 top 和 bottom 属性值改变窗口的默认高度
       *
       * @default "100%"
       */
      height?: PxSize | PercentageSize

      /**
       * 原生子窗体垂直向下的偏移量，支持以 px 为单位的逻辑像素值或百分比
       *
       * 未设置 top 属性值时，优先通过 bottom 和 height 属性值来计算原生子窗体的 top 位置
       *
       * @default "0px"
       */
      top?: PxSize | PercentageSize

      /**
       * 原生子窗体垂直向上的偏移量，支持以 px 为单位的逻辑像素值或百分比
       *
       * 同时设置了 top 和 height 值时，忽略此属性值
       *
       * 未设置 height 时，通过 top 和 bottom 属性值来确定原生子窗体的高度
       *
       * @default 根据 top 和 height 属性值自动计算
       */
      bottom?: PxSize | PercentageSize

      /**
       * 原生子窗体水平向左的偏移量，支持以 px 为单位的逻辑像素值或百分比
       *
       * 未设置 left 属性值时，优先通过 right 和 width 属性值来计算原生子窗体的 left 位置
       *
       * @default "0px"
       */
      left?: PxSize | PercentageSize

      /**
       * 原生子窗体水平向右的偏移量，支持以 px 为单位的逻辑像素值或百分比
       *
       * 同时设置了 left 和 height 值时，忽略此属性值
       *
       * 未设置 width 时，通过 left 和 bottom 属性值来确定原生子窗体的宽度
       *
       * @default 根据 left 和 width 属性值来自动计算
       */
      right?: PxSize | PercentageSize

      /**
       * 原生子窗体的边距，用于定位原生子窗体的位置，若设置了 left、right、top、bottom 则对应的边距值失效
       *
       * "auto" 居中
       */
      margin?: string

      /**
       * 原生子窗体的窗口的堆叠顺序值，拥有更高堆叠顺序的窗口总是会处于堆叠顺序较低的窗口的前面，拥有相同堆叠顺序的窗口后调用 show 方法则在前面
       */
      zindex?: number

      /**
       * 窗口的背景颜色，支持 Hex 颜色
       *
       * Android 平台 4.0 以上系统支持 "transparent" 背景透明样式，比如 subNVue 为圆角时需要设置为 "transparent" 才能看到正确的效果
       *
       * @default "#FFFFFF"
       *
       * @format color
       */
      background?: HEXColor | 'transparent'

      [x: string]: any
    }

    [x: string]: any
  }[]

  /**
   * 页面回弹效果，设置为 "none" 时关闭效果
   *
   * @desc App-vue（nvue Android 无页面级bounce效果，仅 list、recycle-list、waterfall 等滚动组件有 bounce 效果）
   */
  bounce?: string

  /**
   * 侧滑返回功能，仅支持 "close" / "none"
   *
   * "close" 启用侧滑返回
   *
   * "none" 禁用侧滑返回
   *
   * @default "close"
   *
   * @desc App-iOS
   */
  popGesture?: 'close' | 'none'

  /**
   * iOS 软键盘上完成工具栏的显示模式，设置为 "none" 时关闭工具栏
   *
   * @default "auto"
   *
   * @desc App-iOS
   */
  softInputNavBar?: 'auto' | 'none'

  /**
   * 软键盘弹出模式，仅支持 "adjustResize" / "adjustPan"
   *
   * @default "adjustPan"
   *
   * @desc App
   */
  softInputMode?: 'adjustResize' | 'adjustPan'

  /**
   * 下拉刷新
   *
   * @desc App
   */
  pullToRefresh?: {
    /**
     * 是否开启窗口下拉刷新
     *
     * @default false
     */
    support?: boolean

    /**
     * 下拉刷新控件颜色，仅 style 为 "circle" 时有效，支持 HEX 颜色
     *
     * @default "#2BD009"
     *
     * @format color
     */
    color?: HEXColor

    /**
     * 下拉刷新控件样式
     *
     * "default" 下拉拖动时页面内容跟随
     *
     * "circle" 下拉拖动时仅刷新控件跟随
     *
     * @default Android 为 "circle"，iOS 为 "default"
     */
    style?: 'default' | 'circle'

    /**
     * 下拉刷新控件进入刷新状态的拉拽高度，支持以 px 为单位的逻辑像素值或百分比
     */
    height?: PxSize | PercentageSize

    /**
     * 窗口可下拉拖拽的范围，支持以 px 为单位的逻辑像素值或百分比
     */
    range?: PxSize | PercentageSize

    /**
     * 下拉刷新控件的起始位置，仅 style 为 "circle" 时有效，用于定义刷新控件下拉时的起始位置，支持以 px 为单位的逻辑像素值或百分比
     *
     * 如使用了非原生 title 且需要原生下拉刷新，一般都设置 style 为 "circle" 并将 offset 设置为自定义 title 的高度
     */
    offset?: PxSize | PercentageSize

    /**
     * 下拉可刷新状态时配置，仅 style 为 "default" 时有效
     */
    contentdown?: {
      /**
       * 下拉可刷新状态时下拉刷新控件标题内容
       */
      caption?: string

      [x: string]: any
    }

    /**
     * 释放可刷新状态时配置，仅 style 为 "default" 时有效
     */
    contentover?: {
      /**
       * 释放可刷新状态时下拉刷新控件标题内容
       */
      caption?: string

      [x: string]: any
    }

    /**
     * 正在刷新状态时配置，仅 style 为 "default" 时有效
     */
    contentrefresh?: {
      /**
       * 正在刷新状态时下拉刷新控件标题内容
       */
      caption?: string

      [x: string]: any
    }

    [x: string]: any
  }

  /**
   * 滚动条显示策略，设置为 "none" 时不显示滚动条
   *
   * @desc App
   */
  scrollIndicator?: string

  /**
   * 窗口显示的动画效果，详见 [窗口动画](https://uniapp.dcloud.net.cn/api/router#animation)
   *
   * @default "pop-in"
   *
   * @desc App
   */
  animationType?: AnimationType

  /**
   * 窗口显示动画的持续时间，单位为 ms
   *
   * @default 300
   *
   * @desc App
   */
  animationDuration?: number

  [x: string]: any
}
