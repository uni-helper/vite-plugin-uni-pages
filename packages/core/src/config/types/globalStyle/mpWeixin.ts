import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-weixin 平台的特定样式，配置项参考 [MP-WEIXIN](https://uniapp.dcloud.net.cn/collocation/pages#mp-weixin) 和 <https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#window>
 *
 * 相应的类型是 MpWeixin
 *
 * @desc 微信小程序
 */
export interface MpWeixin {
  /**
   * 导航栏背景颜色，支持 HEX 颜色
   *
   * @default "#000000"
   *
   * @format color
   */
  navigationBarBackgroundColor?: HEXColor | ThemeVar

  /**
   * 导航栏标题、状态栏颜色
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
   * @desc iOS / Android 微信客户端 6.6.0，Windows 微信客户端不支持
   *
   * @default "default"
   */
  navigationStyle?: 'default' | 'custom'

  /**
   * 在非首页、非页面栈最底层页面或非 tabbar 内页面中的导航栏展示 home 键
   *
   * @desc 微信客户端 8.0.24
   *
   * @default false
   */
  homeButton?: boolean

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
   * @desc 微信客户端 6.5.16
   *
   * @default "#FFFFFF"
   */
  backgroundColorTop?: HEXColor | ThemeVar

  /**
   * 底部窗口的背景色，仅 iOS 支持
   *
   * @desc 微信客户端 6.5.16
   *
   * @default "#FFFFFF"
   */
  backgroundColorBottom?: HEXColor | ThemeVar

  /**
   * 是否开启全局的下拉刷新，详见 [Page.onPullDownRefresh](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onpulldownrefresh)
   *
   * @default false
   */
  enablePullDownRefresh?: boolean

  /**
   * 页面上拉触底事件触发时距页面底部距离，单位为 px，详见 [Page.onReachBottom](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onreachbottom)
   *
   * @default 50
   */
  onReachBottomDistance?: number

  /**
   * 屏幕旋转设置，支持 auto / portrait / landscape，详见 [响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html)
   *
   * "auto" 自动
   *
   * "portrait" 竖屏
   *
   * "landscape" 横屏
   *
   * @desc [2.4.0](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html) (auto) / [2.5.0](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html) (landscape)
   *
   * @default "portrait"
   */
  pageOrientation?: 'auto' | 'portrait' | 'landscape'

  /**
   * 重新启动策略配置
   *
   * "homePage" 如果从这个页面退出小程序，下次将从首页冷启动
   *
   * "homePageAndLatestPage" 如果从这个页面退出小程序，下次冷启动后立刻加载这个页面，页面的参数保持不变（不可用于 tab 页）
   *
   * @desc [2.8.0](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html)
   */
  restartStrategy?: 'homePage' | 'homePageAndLatestPage'

  /**
   * 页面初始渲染缓存配置，详见 [初始渲染缓存](https://developers.weixin.qq.com/miniprogram/dev/framework/view/initial-rendering-cache.html)
   *
   * @desc [2.11.1](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html)
   */
  initialRenderingCache?: 'static' | 'dynamic'

  /**
   * 切入系统后台时，隐藏页面内容，保护用户隐私
   *
   * @desc [2.15.0](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html)
   *
   * @default "none"
   */
  visualEffectInBackground?: 'hidden' | 'none'

  /**
   * 控制预加载下个页面的时机，详见 [控制预加载下个页面的时机](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_nav.html#_2-4-%E6%8E%A7%E5%88%B6%E9%A2%84%E5%8A%A0%E8%BD%BD%E4%B8%8B%E4%B8%AA%E9%A1%B5%E9%9D%A2%E7%9A%84%E6%97%B6%E6%9C%BA)
   *
   * "static" 在当前页面 onReady 触发 200ms 后触发预加载
   *
   * "auto" 渲染线程空闲时进行预加载，由基础库根据一段时间内 requestAnimationFrame 的触发频率算法判断
   *
   * "manual" 由开发者通过调用 [wx.preloadWebview](https://developers.weixin.qq.com/miniprogram/dev/api/base/performance/wx.preloadWebview.html) 触发，开发者可以在页面主要内容的 setData 结束后手动触发
   *
   * @desc [2.15.0](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html)
   *
   * @default "static"
   */
  handleWebviewPreload?: 'static' | 'manual' | 'auto'

  [x: string]: any
}
