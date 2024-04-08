import type { PageMetaDatum } from '../../types'
import type { Condition } from './condition'
import type { EasyCom } from './easycom'
import type { GlobalStyle } from './globalStyle'
import type { SubPackages } from './subPackages'
import type { TabBar } from './tabBar'
import type { TheWindow } from './theWindow'
import type { UniIdRouter } from './uniIdRouter'

export * from './easycom'
export * from './globalStyle'
export * from './tabBar'

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
   *
   * @desc 微信小程序
   */
  workers?: string | {
    /**
     * `Worker` 代码放置的目录
     */
    path: string

    /**
     * 是否打包为分包
     *
     * @desc 微信小程序基础库 v2.27.3
     *
     * @default false
     */
    isSubpackage?: boolean
  }

  /**
   * 大屏左侧窗口
   *
   * @desc H5
   */
  leftWindow?: TheWindow

  /**
   * 大屏顶部窗口
   *
   * @desc H5
   */
  topWindow?: TheWindow

  /**
   * 大屏右侧窗口
   *
   * @desc H5
   */
  rightWindow?: TheWindow

  /**
   * 自动跳转相关配置，新增于 HBuilderX 3.5.0
   *
   * @desc uni-app 3.5.0+、uni-app-x 3.99+
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
