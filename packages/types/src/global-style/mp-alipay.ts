import type { HEXColor, ThemeVar } from '../common'

/**
 * 设置编译到 mp-alipay 平台的特定样式，配置项参考 [MP-ALIPAY](https://uniapp.dcloud.net.cn/collocation/pages#mp-alipay) 和 <https://opendocs.alipay.com/mini/framework/app-json#window>
 *
 * 相应的类型是 MpAlipay
 *
 * @desc 支付宝小程序
 */
export interface MpAlipay {
  /**
   * 是否允许向下拉拽
   *
   * @default "YES"
   */
  allowsBounceVertical?: 'YES' | 'NO'

  /**
   * 窗口的背景色，支持 HEX 颜色
   *
   * @format color
   */
  backgroundColor?: HEXColor | ThemeVar

  /**
   * 下拉露出显示背景图的底色，仅 Android 有效，iOS 下页面背景图底色会使用 backgroundColor 的值
   *
   * @format color
   */
  backgroundImageColor?: HEXColor

  /**
   * 下拉露出显示背景图的链接，支持网络地址和本地地址，尽量使用绝对地址
   */
  backgroundImageUrl?: string

  /**
   * 页面默认标题
   */
  defaultTitle?: string

  /**
   * 仅支持 Android，是否显示 WebView 滚动条
   *
   * @default "YES"
   */
  enableScrollBar?: 'YES' | 'NO'

  /**
   * 仅支持 iOS，是否支持手势返回
   *
   * @default "YES"
   */
  gestureBack?: 'YES' | 'NO'

  /**
   * 页面上拉触底时触发时距离页面底部的距离，单位为 px，详情可查看 [页面事件处理函数](https://opendocs.alipay.com/mini/framework/page-detail#%E9%A1%B5%E9%9D%A2%E4%BA%8B%E4%BB%B6%E5%A4%84%E7%90%86%E5%87%BD%E6%95%B0)
   *
   * @desc [1.19.0](https://opendocs.alipay.com/mini/framework/compatibility)，目前 iOS 在 page.json 下设置无效，只能全局设置
   */
  onReachBottomDistance?: number

  /**
   * 是否允许下拉刷新，allowsBounceVertical 值需要为 "YES"，全局配置后全局生效，但是如果单个页面配置了该参数，以页面的配置为准
   *
   * @default false
   */
  pullRefresh?: boolean

  /**
   * rpx 单位是否宽度自适应
   *
   * 当设置为 false 时，2 rpx 将恒等于 1 px，不再根据屏幕宽度进行自适应，此时 750 rpx 将不再等于 100% 宽度
   *
   * @desc [1.23.0](https://opendocs.alipay.com/mini/framework/compatibility)
   *
   * @default true
   */
  responsive?: boolean

  /**
   * 是否进入时显示导航栏的 loading
   *
   * @default "NO"
   */
  showTitleLoading?: 'YES' | 'NO'

  /**
   * 导航栏透明设置
   *
   * always 一直透明
   *
   * auto 滑动自适应
   *
   * none 不透明
   *
   * @default "none"
   */
  transparentTitle?: 'always' | 'auto' | 'none'

  /**
   * 导航栏点击穿透
   *
   * @default "NO"
   */
  titlePenetrate?: 'YES' | 'NO'

  /**
   * 导航栏图片地址，会替换当前文字标题，只支持 https 图片链接
   */
  titleImage?: string

  /**
   * 导航栏背景色，支持 HEX 颜色
   */
  titleBarColor?: HEXColor

  /**
   * 导航栏前景色
   *
   * @desc [支付宝客户端 10.5.30](https://opendocs.alipay.com/mini/framework/compatibility)
   */
  navigationBarFrontColor?: 'black' | 'white'

  [x: string]: any
}
