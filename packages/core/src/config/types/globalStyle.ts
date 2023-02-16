import type { AppPlus } from './appPlus'
import type { HEXColor, ThemeColor } from './common'
import type { H5 } from './h5'

export interface GlobalStyle {
  /**
   * 导航栏背景颜色（同状态栏背景色）
   * @default "#F7F7F7"
   * @desc APP与H5为#F7F7F7，小程序平台请参考相应小程序文档
   */
  navigationBarBackgroundColor?: HEXColor | ThemeColor

  /**
   * 导航栏标题颜色及状态栏前景颜色，仅支持 black/white
   * @default "white"
   * @desc 支付宝小程序不支持，请使用 my.setNavigationBar
   */
  navigationBarTextStyle?: string

  /**
   * 导航栏标题文字内容
   * @desc
   */
  navigationBarTitleText?: string

  /**
   * 导航栏样式，仅支持 default/custom。custom即取消默认的原生导航栏，需看使用注意
   * @default "default"
   * @desc 微信小程序 7.0+、百度小程序、H5、App（2.0.3+）
   */
  navigationStyle?: string

  /**
   * 下拉显示出来的窗口的背景色
   * @default "#ffffff"
   * @desc 微信小程序
   */
  backgroundColor?: HEXColor | ThemeColor

  /**
   * 下拉 loading 的样式，仅支持 dark / light
   * @default "dark"
   * @desc 微信小程序
   */
  backgroundTextStyle?: string

  /**
   * 是否开启下拉刷新，详见页面生命周期。
   * @default "false"
   * @desc
   */
  enablePullDownRefresh?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位只支持px，详见页面生命周期
   * @default "50"
   * @desc
   */
  onReachBottomDistance?: number

  /**
   * 顶部窗口的背景色（bounce回弹区域）
   * @default "#ffffff"
   * @desc 仅 iOS 平台
   */
  backgroundColorTop?: HEXColor | ThemeColor

  /**
   * 底部窗口的背景色（bounce回弹区域）
   * @default "#ffffff"
   * @desc 仅 iOS 平台
   */
  backgroundColorBottom?: HEXColor | ThemeColor

  /**
   * 导航栏图片地址（替换当前文字标题），支付宝小程序内必须使用https的图片链接地址
   * @desc 支付宝小程序、H5、APP
   */
  titleImage?: string

  /**
   * 导航栏整体（前景、背景）透明设置。支持 always 一直透明 / auto 滑动自适应 / none 不透明
   * @default "none"
   * @desc 支付宝小程序、H5、APP
   */
  transparentTitle?: string

  /**
   * 导航栏点击穿透
   * @default "NO"
   * @desc 支付宝小程序、H5
   */
  titlePenetrate?: string

  /**
   * 横屏配置，屏幕旋转设置，仅支持 auto / portrait / landscape 详见 响应显示区域变化
   * @default "portrait"
   * @desc App 2.4.7+、微信小程序、QQ小程序
   */
  pageOrientation?: string

  /**
   * 窗口显示的动画效果，详见：窗口动画
   * @default "pop-in"
   * @desc App
   */
  animationType?: string

  /**
   * 窗口显示动画的持续时间，单位为 ms
   * @default "300"
   * @desc App
   */
  animationDuration?: number

  /**
   * 设置编译到 App 平台的特定样式，配置项参考下方 app-plus
   * @desc App
   */
  'app-plus'?: AppPlus

  /**
   * 设置编译到 H5 平台的特定样式，配置项参考下方 H5
   * @type H5
   * @desc H5
   */
  h5?: H5

  /**
   * 设置编译到 mp-alipay 平台的特定样式，配置项参考下方 MP-ALIPAY
   * @desc 支付宝小程序
   */
  'mp-alipay'?: object

  /**
   * 设置编译到 mp-weixin 平台的特定样式
   * @desc 微信小程序
   */
  'mp-weixin'?: object

  /**
   * 设置编译到 mp-baidu 平台的特定样式
   * @desc 百度小程序
   */
  'mp-baidu'?: object

  /**
   * 设置编译到 mp-toutiao 平台的特定样式
   * @desc 字节跳动小程序
   */
  'mp-toutiao'?: object

  /**
   * 设置编译到 mp-lark 平台的特定样式
   * @desc 飞书小程序
   */
  'mp-lark'?: object

  /**
   * 设置编译到 mp-qq 平台的特定样式
   * @desc QQ小程序
   */
  'mp-qq'?: object

  /**
   * 设置编译到 mp-kuaishou 平台的特定样式
   * @desc 快手小程序
   */
  'mp-kuaishou'?: object

  /**
   * 设置编译到 mp-jd 平台的特定样式
   * @desc 京东小程序
   */
  'mp-jd'?: object

  /**
   * 引用小程序组件，参考 小程序组件
   * @type Record<string, string>
   * @desc
   */
  usingComponents?: Record<string, string>

  /**
   * 同层渲染，webrtc(实时音视频) 无法正常时尝试配置 seperated 强制关掉同层
   * @desc 微信小程序
   */
  renderingMode?: string

  /**
   * 当存在 leftWindow 时，默认是否显示 leftWindow
   * @default "true"
   * @desc H5
   */
  leftWindow?: boolean

  /**
   * 当存在 topWindow 时，默认是否显示 topWindow
   * @default "true"
   * @desc H5
   */
  topWindow?: boolean

  /**
   * 当存在 rightWindow 时，默认是否显示 rightWindow
   * @default "true"
   * @desc H5
   */
  rightWindow?: boolean

  /**
   * rpx 计算所支持的最大设备宽度，单位 px
   * @default "960"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcMaxDeviceWidth?: number

  /**
   * rpx 计算使用的基准设备宽度，设备实际宽度超出 rpx 计算所支持的最大设备宽度时将按基准宽度计算，单位 px
   * @default "375"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcBaseDeviceWidth?: number

  /**
   * rpx 计算特殊处理的值，始终按实际的设备宽度计算，单位 rpx
   * @default "750"
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  rpxCalcIncludeWidth?: number

  /**
   * 动态 rpx，屏幕大小变化会重新渲染 rpx
   * @default "false"
   * @desc App-nvue（vue3 固定值为 true） 3.2.13+
   */
  dynamicRpx?: boolean

  /**
   * 单位px，当浏览器可见区域宽度大于maxWidth时，两侧留白，当小于等于maxWidth时，页面铺满；不同页面支持配置不同的maxWidth；maxWidth = leftWindow(可选)+page(页面主体)+rightWindow(可选)
   * @desc H5（2.9.9+）
   */
  maxWidth?: number

  [x: string]: any
}
