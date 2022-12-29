import type { hexcolor } from './common'
export interface AppPlus {
  /**
   * 窗体背景色。无论vue页面还是nvue页面，在App上都有一个父级原生窗体，该窗体的背景色生效时间快于页面里的css生效时间
   * @type HexColor
   * @default "#FFFFFF"
   * @desc App
   */
  background: hexcolor
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
  softinputNavBar: string
  /**
   * 软键盘弹出模式，支持 adjustResize、adjustPan 两种模式
   * @type String
   * @default "adjustPan"
   * @desc App
   */
  softinputMode: string
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
export interface H5 {
  /**
   * 背景颜色，颜色值格式为"#RRGGBB"。
   * @type String
   * @default "#F7F7F7"
   * @desc
   */
  backgroundColor: string
  /**
   * 自定义按钮，参考 buttons
   * @type Array
   * @desc
   */
  buttons: any[]
  /**
   * 标题文字颜色
   * @type String
   * @default "#000000"
   * @desc
   */
  titleColor: string
  /**
   * 标题文字内容
   * @type String
   * @desc
   */
  titleText: string
  /**
   * 标题文字字体大小
   * @type String
   * @desc
   */
  titleSize: string
  /**
   * 导航栏样式。"default"-默认样式；"transparent"-透明渐变。
   * @type String
   * @default "default"
   * @desc
   */
  type: string
  /**
   * 导航栏上的搜索框样式，详见：searchInput
   * @type Object
   * @desc 1.6.5
   */
  searchInput: object
  [x: string]: any
}
export interface GlobalStyle {
  /**
   * 导航栏背景颜色（同状态栏背景色）
   * @type HexColor
   * @default "#F7F7F7"
   * @desc APP与H5为#F7F7F7，小程序平台请参考相应小程序文档
   */
  navigationBarBackgroundColor: hexcolor
  /**
   * 导航栏标题颜色及状态栏前景颜色，仅支持 black/white
   * @type String
   * @default "white"
   * @desc 支付宝小程序不支持，请使用 my.setNavigationBar
   */
  navigationBarTextStyle: string
  /**
   * 导航栏标题文字内容
   * @type String
   * @desc
   */
  navigationBarTitleText: string
  /**
   * 导航栏样式，仅支持 default/custom。custom即取消默认的原生导航栏，需看使用注意
   * @type String
   * @default "default"
   * @desc 微信小程序 7.0+、百度小程序、H5、App（2.0.3+）
   */
  navigationStyle: string
  /**
   * 下拉显示出来的窗口的背景色
   * @type HexColor
   * @default "#ffffff"
   * @desc 微信小程序
   */
  backgroundColor: hexcolor
  /**
   * 下拉 loading 的样式，仅支持 dark / light
   * @type String
   * @default "dark"
   * @desc 微信小程序
   */
  backgroundTextStyle: string
  /**
   * 是否开启下拉刷新，详见页面生命周期。
   * @type Boolean
   * @default "false"
   * @desc
   */
  enablePullDownRefresh: boolean
  /**
   * 页面上拉触底事件触发时距页面底部距离，单位只支持px，详见页面生命周期
   * @type Number
   * @default "50"
   * @desc
   */
  onReachBottomDistance: number
  /**
   * 顶部窗口的背景色（bounce回弹区域）
   * @type HexColor
   * @default "#ffffff"
   * @desc 仅 iOS 平台
   */
  backgroundColorTop: hexcolor
  /**
   * 底部窗口的背景色（bounce回弹区域）
   * @type HexColor
   * @default "#ffffff"
   * @desc 仅 iOS 平台
   */
  backgroundColorBottom: hexcolor
  /**
   * 导航栏图片地址（替换当前文字标题），支付宝小程序内必须使用https的图片链接地址
   * @type String
   * @desc 支付宝小程序、H5、APP
   */
  titleImage: string
  /**
   * 导航栏整体（前景、背景）透明设置。支持 always 一直透明 / auto 滑动自适应 / none 不透明
   * @type String
   * @default "none"
   * @desc 支付宝小程序、H5、APP
   */
  transparentTitle: string
  /**
   * 导航栏点击穿透
   * @type String
   * @default "NO"
   * @desc 支付宝小程序、H5
   */
  titlePenetrate: string
  /**
   * 横屏配置，屏幕旋转设置，仅支持 auto / portrait / landscape 详见 响应显示区域变化
   * @type String
   * @default "portrait"
   * @desc App 2.4.7+、微信小程序、QQ小程序
   */
  pageOrientation: string
  /**
   * 窗口显示的动画效果，详见：窗口动画
   * @type String
   * @default "pop-in"
   * @desc App
   */
  animationType: string
  /**
   * 窗口显示动画的持续时间，单位为 ms
   * @type Number
   * @default "300"
   * @desc App
   */
  animationDuration: number
  /**
   * 设置编译到 App 平台的特定样式，配置项参考下方 app-plus
   * @type AppPlus
   * @desc App
   */
  'app-plus': AppPlus
  /**
   * 设置编译到 H5 平台的特定样式，配置项参考下方 H5
   * @type H5
   * @desc H5
   */
  h5: H5
  /**
   * 设置编译到 mp-alipay 平台的特定样式，配置项参考下方 MP-ALIPAY
   * @type Object
   * @desc 支付宝小程序
   */
  'mp-alipay': object
  /**
   * 设置编译到 mp-weixin 平台的特定样式
   * @type Object
   * @desc 微信小程序
   */
  'mp-weixin': object
  /**
   * 设置编译到 mp-baidu 平台的特定样式
   * @type Object
   * @desc 百度小程序
   */
  'mp-baidu': object
  /**
   * 设置编译到 mp-toutiao 平台的特定样式
   * @type Object
   * @desc 字节跳动小程序
   */
  'mp-toutiao': object
  /**
   * 设置编译到 mp-lark 平台的特定样式
   * @type Object
   * @desc 飞书小程序
   */
  'mp-lark': object
  /**
   * 设置编译到 mp-qq 平台的特定样式
   * @type Object
   * @desc QQ小程序
   */
  'mp-qq': object
  /**
   * 设置编译到 mp-kuaishou 平台的特定样式
   * @type Object
   * @desc 快手小程序
   */
  'mp-kuaishou': object
  /**
   * 设置编译到 mp-jd 平台的特定样式
   * @type Object
   * @desc 京东小程序
   */
  'mp-jd': object
  /**
   * 引用小程序组件，参考 小程序组件
   * @type Record<string, string>
   * @desc
   */
  usingComponents: Record<string, string>
  /**
   * 同层渲染，webrtc(实时音视频) 无法正常时尝试配置 seperated 强制关掉同层
   * @type String
   * @desc 微信小程序
   */
  renderingMode: string
  /**
   * 当存在 leftWindow 时，默认是否显示 leftWindow
   * @type Boolean
   * @default "true"
   * @desc H5
   */
  leftWindow: boolean
  /**
   * 当存在 topWindow 时，默认是否显示 topWindow
   * @type Boolean
   * @default "true"
   * @desc H5
   */
  topWindow: boolean
  /**
   * 当存在 rightWindow 时，默认是否显示 rightWindow
   * @type Boolean
   * @default "true"
   * @desc H5
   */
  rightWindow: boolean
  /**
   * rpx 计算所支持的最大设备宽度，单位 px
   * @type Number
   * @default "960"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcMaxDeviceWidth: number
  /**
   * rpx 计算使用的基准设备宽度，设备实际宽度超出 rpx 计算所支持的最大设备宽度时将按基准宽度计算，单位 px
   * @type Number
   * @default "375"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcBaseDeviceWidth: number
  /**
   * rpx 计算特殊处理的值，始终按实际的设备宽度计算，单位 rpx
   * @type Number
   * @default "750"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcIncludeWidth: number
  /**
   * 动态 rpx，屏幕大小变化会重新渲染 rpx
   * @type Boolean
   * @default "false"
   * @desc App-nvue（vue3 固定值为 true） 3.2.13+
   */
  dynamicRpx: boolean
  /**
   * 单位px，当浏览器可见区域宽度大于maxWidth时，两侧留白，当小于等于maxWidth时，页面铺满；不同页面支持配置不同的maxWidth；maxWidth = leftWindow(可选)+page(页面主体)+rightWindow(可选)
   * @type Number
   * @desc H5（2.9.9+）
   */
  maxWidth: number
  [x: string]: any
}
