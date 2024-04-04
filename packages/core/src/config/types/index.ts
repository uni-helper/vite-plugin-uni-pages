import type { PageMetaDatum } from '../../types'
import type { EasyCom } from './easycom'
import type { GlobalStyle } from './globalStyle'
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
     * @default 768
     */
    minWidth?: number
  }
}

export interface PreloadRule {
  /**
   * 进入页面后预下载分包的 root 或 name。__APP__ 表示主包。
   */
  packages?: string[]

  /**
   * 在指定网络下预下载，可选值为：all（不限网络）、wifi（仅wifi下预下载）
   * @default "wifi"
   */
  network?: string
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

export interface SubPackage {
  /**
   * 子包的根目录
   */
  root?: string

  /**
   * 子包由哪些页面组成，参数同 pages
   */
  pages?: PageMetaDatum[]
}

export interface ConditionItem {
  /**
   * 启动模式名称
   */
  name?: string

  /**
   * 启动页面路径
   */
  path: string

  /**
   * 启动参数，可在页面的 onLoad 函数里获得
   */
  query?: string
}

export interface Condition {
  /**
   * 当前激活的模式，list节点的索引值
   */
  current?: number

  /**
   * 启动模式列表
   */
  list?: Partial<ConditionItem>[]
}

export interface PagesConfig {
  /**
   * 设置页面路径及窗口表现
   */
  pages?: PageMetaDatum[]

  /**
   * 设置默认页面的窗口表现
   */
  globalStyle?: GlobalStyle

  /**
   * 组件自动引入规则
   * @desc 2.5.5+
   */
  easycom?: EasyCom

  /**
   * 设置底部 tab 的表现
   */
  tabBar?: TabBar

  /**
   * 启动模式配置
   */
  condition?: Condition

  /**
   * 分包加载配置
   */
  subPackages?: SubPackage[]

  /**
   * 分包预下载规则
   * @desc 微信小程序
   */
  preloadRule?: {
    [path: string]: PreloadRule
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
   */
  entryPagePath?: string

  [x: string]: any
}

export interface UserPagesConfig extends PagesConfig {}
