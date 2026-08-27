import type { PageStyle } from './style'

/**
 * 配置显示该窗口的规则
 */
export interface MatchMedia {
  /**
   * 当设备可见区域宽度 >= minWidth 时，显示该 window
   *
   * @default 768
   */
  minWidth?: number
}

/**
 * leftWindow / topWindow / rightWindow 的类型
 */
export interface TheWindow {
  /**
   * 配置页面路径
   */
  path: string

  /**
   * 配置页面窗口表现，配置项参考 [pageStyle](https://uniapp.dcloud.net.cn/collocation/pages#style)
   */
  style?: PageStyle

  /**
   * 配置显示该窗口的规则，配置项参考 [matchMedia](https://uniapp.dcloud.net.cn/collocation/pages#matchmedia)
   */
  matchMedia?: MatchMedia

  [x: string]: any
}
