import type { AnimationType, HEXColor, ThemeVar } from '../common'
import type { H5 } from './h5'
import type { AppPlus } from './appPlus'
import type { MpAlipay } from './mpAlipay'
import type { MpWeixin } from './mpWeixin'
import type { MpBaidu } from './mpBaidu'
import type { MpToutiao } from './mpToutiao'
import type { MpLark } from './mpLark'
import type { MpQq } from './mpQq'
import type { MpKuaishou } from './mpKuaishou'
import type { MpJd } from './mpJd'

export interface GlobalStyle {
  /**
   * 导航栏背景颜色（同状态栏背景色），支持 HEX 颜色
   *
   * @desc APP 与 H5 为 #F8F8F8，小程序平台请参考相应小程序文档
   *
   * @format color
   */
  'navigationBarBackgroundColor'?: HEXColor | ThemeVar

  /**
   * 导航栏标题颜色及状态栏前景颜色，仅支持 "black" / "white"
   *
   * @default "black"
   *
   * @desc 支付宝小程序不支持，请使用 my.setNavigationBar
   */
  'navigationBarTextStyle'?: 'black' | 'white' | ThemeVar

  /**
   * 导航栏标题文字内容
   */
  'navigationBarTitleText'?: string

  /**
   * 导航栏阴影
   */
  'navigationBarShadow'?: {
    /**
     * 阴影颜色
     */
    colorType?: 'grey' | 'blue' | 'green' | 'orange' | 'red' | 'yellow'
  }

  /**
   * 导航栏样式，仅支持 "default" / "custom"
   *
   * "custom" 即取消默认的原生导航栏，详看 [使用注意](https://uniapp.dcloud.net.cn/collocation/pages#customnav)
   *
   * @default "default"
   *
   * @desc 微信小程序 7.0+、百度小程序、H5、App（2.0.3+）
   */
  'navigationStyle'?: 'default' | 'custom'

  /**
   * 下拉显示出来的窗口的背景色，支持 HEX 颜色
   *
   * @default "#ffffff"
   *
   * @desc 微信小程序
   *
   * @format color
   */
  'backgroundColor'?: HEXColor | ThemeVar

  /**
   * 下拉 loading 的样式，仅支持 "dark" / "light"
   *
   * @default "dark"
   *
   * @desc 微信小程序
   */
  'backgroundTextStyle'?: 'dark' | 'light' | ThemeVar

  /**
   * 是否开启下拉刷新，详见 [页面生命周期](https://uniapp.dcloud.net.cn/tutorial/page.html#lifecycle)
   *
   * @default false
   */
  'enablePullDownRefresh'?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位为 px，详见 [页面生命周期](https://uniapp.dcloud.net.cn/tutorial/page.html#lifecycle)
   *
   * @default 50
   */
  'onReachBottomDistance'?: number

  /**
   * 顶部窗口的背景色（bounce回弹区域）
   *
   * @default "#ffffff"
   *
   * @desc iOS
   *
   * @format color
   */
  'backgroundColorTop'?: HEXColor | ThemeVar

  /**
   * 底部窗口的背景色（bounce回弹区域）
   *
   * @default "#ffffff"
   *
   * @desc iOS
   *
   * @format color
   */
  'backgroundColorBottom'?: HEXColor | ThemeVar

  /**
   * 导航栏图片地址（替换当前文字标题）
   *
   * 支付宝小程序内必须使用 https 图片链接地址
   *
   * @desc 支付宝小程序、H5、APP
   */
  'titleImage'?: string

  /**
   * 导航栏整体（前景、背景）透明设置，仅支持 "always" / "auto" / "none
   *
   * "always" 一直透明
   *
   * "auto" 滑动自适应
   *
   * "none" 不透明
   *
   * @default "none"
   *
   * @desc 支付宝小程序、H5、APP
   */
  'transparentTitle'?: 'always' | 'auto' | 'none'

  /**
   * 导航栏点击穿透
   *
   * @default "NO"
   *
   * @desc 支付宝小程序、H5
   */
  'titlePenetrate'?: 'YES' | 'NO'

  /**
   * 横屏配置，屏幕旋转设置，仅支持 "auto" / "portrait" / "landscape"，详见 [响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html)
   *
   * "auto" 自动
   *
   * "portrait" 竖屏
   *
   * "landscape" 横屏
   *
   * @default "portrait"
   *
   * @desc App 2.4.7+、微信小程序、QQ小程序
   */
  'pageOrientation'?: string

  /**
   * 窗口显示的动画效果，详见 [窗口动画](https://uniapp.dcloud.net.cn/api/router#animation)
   *
   * @default "pop-in"
   *
   * @desc App
   */
  'animationType'?: AnimationType

  /**
   * 窗口显示动画的持续时间，单位为 ms
   *
   * @default 300
   *
   * @desc App
   */
  'animationDuration'?: number

  /**
   * 设置编译到 App 平台的特定样式，配置项参考 [app-plus](https://uniapp.dcloud.net.cn/collocation/pages#app-plus)
   *
   * 相应的类型是 AppPlus
   *
   * @desc App
   */
  'app-plus'?: AppPlus

  /**
   * 设置编译到 H5 平台的特定样式，配置项参考 [H5](https://uniapp.dcloud.net.cn/collocation/pages#h5)
   *
   * 相应的类型是 H5
   *
   * @desc H5
   */
  'h5'?: H5

  /**
   * 设置编译到 mp-alipay 平台的特定样式，配置项参考 [MP-ALIPAY](https://uniapp.dcloud.net.cn/collocation/pages#mp-alipay) 和 <https://opendocs.alipay.com/mini/framework/app-json#window>
   *
   * 相应的类型是 MpAlipay
   *
   * @desc 支付宝小程序
   */
  'mp-alipay'?: MpAlipay

  /**
   * 设置编译到 mp-weixin 平台的特定样式，配置项参考 [MP-WEIXIN](https://uniapp.dcloud.net.cn/collocation/pages#mp-weixin) 和 <https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#window>
   *
   * 相应的类型是 MpWeixin
   *
   * @desc 微信小程序
   */
  'mp-weixin'?: MpWeixin

  /**
   * 设置编译到 mp-baidu 平台的特定样式，配置项参考 [MP-BAIDU](https://uniapp.dcloud.net.cn/collocation/pages.html#mp-baidu) 和 <https://smartprogram.baidu.com/docs/develop/framework/process/#window>
   *
   * 相应的类型是 MpBaidu
   *
   * @desc 百度小程序
   */
  'mp-baidu'?: MpBaidu

  /**
   * 设置编译到 mp-toutiao 平台的特定样式，配置项参考 <https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/framework/general-configuration#window>
   *
   * 相应的类型是 MpToutiao
   *
   * @desc 抖音小程序
   */
  'mp-toutiao'?: MpToutiao

  /**
   * 设置编译到 mp-lark 平台的特定样式
   *
   * 相应的类型是 MpLark
   *
   * @desc 飞书小程序
   */
  'mp-lark'?: MpLark

  /**
   * 设置编译到 mp-qq 平台的特定样式
   *
   * 相应的类型是 MpQq
   *
   * @desc QQ 小程序
   */
  'mp-qq'?: MpQq

  /**
   * 设置编译到 mp-kuaishou 平台的特定样式
   *
   * 相应的类型是 MpKuaishou
   *
   * @desc 快手小程序
   */
  'mp-kuaishou'?: MpKuaishou

  /**
   * 设置编译到 mp-jd 平台的特定样式
   *
   * 相应的类型是 MpJd
   *
   * @desc 京东小程序
   */
  'mp-jd'?: MpJd

  /**
   * 引用小程序组件，详见 [小程序组件](https://uniapp.dcloud.net.cn/tutorial/miniprogram-subject.html#%E5%B0%8F%E7%A8%8B%E5%BA%8F%E8%87%AA%E5%AE%9A%E4%B9%89%E7%BB%84%E4%BB%B6%E6%94%AF%E6%8C%81)
   *
   * @desc App、微信小程序、支付宝小程序、百度小程序、京东小程序
   */
  'usingComponents'?: Record<string, string>

  /**
   * 同层渲染，webrtc（实时音视频）无法正常时尝试配置为 "seperated" 强制关掉同层渲染
   *
   * @desc 微信小程序
   */
  'renderingMode'?: string

  /**
   * 当存在 leftWindow 时，默认是否显示 leftWindow，详见 [topWindow](https://uniapp.dcloud.net.cn/collocation/pages.html#topwindow)
   *
   * @default true
   *
   * @desc H5
   */
  'leftWindow'?: boolean

  /**
   * 当存在 topWindow 时，默认是否显示 topWindow，详见 [topWindow](https://uniapp.dcloud.net.cn/collocation/pages.html#topwindow)
   *
   * @default true
   *
   * @desc H5
   */
  'topWindow'?: boolean

  /**
   * 当存在 rightWindow 时，默认是否显示 rightWindow，详见 [topWindow](https://uniapp.dcloud.net.cn/collocation/pages.html#topwindow)
   *
   * @default true
   *
   * @desc H5
   */
  'rightWindow'?: boolean

  /**
   * rpx 计算所支持的最大设备宽度，单位为 px
   *
   * @default 960
   *
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  'rpxCalcMaxDeviceWidth'?: number

  /**
   * rpx 计算使用的基准设备宽度，设备实际宽度超出 rpx 计算所支持的最大设备宽度时将按基准宽度计算，单位为 px
   *
   * @default 375
   *
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  'rpxCalcBaseDeviceWidth'?: number

  /**
   * rpx 计算特殊处理的值，始终按实际的设备宽度计算，单位为 rpx
   *
   * @default 750
   *
   * @desc App（vue2 且不含 nvue）、H5（2.8.12+）
   */
  'rpxCalcIncludeWidth'?: number

  /**
   * 是否使用动态 rpx，屏幕大小变化会重新渲染 rpx
   *
   * @default false
   *
   * @desc App-nvue（vue3 固定值为 true） 3.2.13+
   */
  'dynamicRpx'?: boolean

  /**
   * 当浏览器可见区域宽度大于 maxWidth 时两侧留白，当小于等于 maxWidth 时页面铺满，单位为 px
   *
   * 不同页面支持配置不同的 maxWidth
   *
   * maxWidth = leftWindow（可选）+ page（页面主体）+ rightWindow（可选）
   *
   * 使用时，页面内 fixed 元素需要使用 --window-left 和 --window-right 来保证布局位置正确
   *
   * @desc H5（2.9.9+）
   */
  'maxWidth'?: number

  [x: string]: any
}
