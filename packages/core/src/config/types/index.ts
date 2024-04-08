import type { PageMetaDatum } from '../../types'
import type { Condition } from './condition'
import type { EasyCom } from './easycom'
import type { GlobalStyle } from './globalStyle'
import type { SubPackages } from './subPackages'
import type { TabBar } from './tabBar'

export * from './easycom'
export * from './globalStyle'
export * from './tabBar'

export interface TheWindow {
  /**
   * 配置页面路径
   */
  path: string

  /**
   * 配置页面窗口表现，配置项参考下方 pageStyle
   */
  style?: GlobalStyle

  /**
   * 配置显示该窗口的规则，配置项参考下方 matchMedia
   */
  matchMedia?: {
    /**
     * 当设备可见区域宽度 >= minWidth 时，显示该 window
     * @default "768"
     */
    minWidth?: number
  }
}

export interface UniIdRouter {
  /**
   * 登录页面路径
   */
  loginPage: string
  /**
   * 需要登录才可以访问的页面列表，可以使用正则语法
   */
  needLogin: string[]
  /**
   * 是否自动解析云对象及 clientDB 的错误码，如果是客户端 token 不正确或 token 过期则自动跳转配置的登录页面
   *
   * @default true
   */
  resToLogin?: boolean
}

/**
 * 对 uni-app 进行全局配置，决定页面文件的路径、窗口样式、原生的导航栏、底部的原生 tabBar 等，类似微信小程序中 app.json 的页面管理部分
 *
 * 注意定位权限申请等原属于 app.json 的内容，需要在 manifest 中配置
 */
export interface PagesConfig {
  /**
   * 设置默认页面的窗口表现
   */
  globalStyle?: GlobalStyle

  /**
   * 设置页面路径及窗口表现
   */
  pages?: PageMetaDatum[]

  /**
   * 组件自动引入规则
   *
   * @desc 2.5.5+
   */
  easycom?: EasyCom

  /**
   * 设置底部 tab 的表现
   */
  tabBar?: TabBar

  /**
   * 启动模式配置，仅开发期间生效
   */
  condition?: Condition

  /**
   * 分包加载配置
   *
   * @desc H5 不支持
   */
  subPackages?: SubPackages

  /**
   * 分包预下载规则
   *
   * @desc 微信小程序
   */
  preloadRule?: {
    /**
     * 页面路径
     */
    [path: string]: {
      /**
       * 进入页面后预下载分包的 root 或 name
       *
       * __APP__ 表示主包
       */
      packages: string[]

      /**
       * 在指定网络下预下载
       *
       * "all" 不限网络
       *
       * "wifi" 仅 wifi 下预下载
       *
       * @default "wifi"
       */
      network?: 'all' | 'wifi'
    }
  }

  /**
   * `Worker` 代码放置的目录
   * @desc 微信小程序
   */
  workers?: any

  /**
   * 大屏左侧窗口
   * @desc H5
   */
  leftWindow?: TheWindow

  /**
   * 大屏顶部窗口
   * @desc H5
   */
  topWindow?: TheWindow

  /**
   * 大屏右侧窗口
   * @desc H5
   */
  rightWindow?: TheWindow

  /**
   * 自动跳转相关配置，新增于 HBuilderX 3.5.0
   */
  uniIdRouter?: UniIdRouter

  /**
   * 默认启动首页，新增于 HBuilderX 3.7.0
   *
   * @desc 微信小程序、支付宝小程序
   */
  entryPagePath?: string

  [x: string]: any
}

export interface UserPagesConfig extends PagesConfig {}
