/**
 * 进入页面后预下载分包的规则
 */
export interface PreloadRuleItem {
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

  [x: string]: any
}

/**
 * 分包预下载规则
 *
 * @desc 微信小程序、QQ 小程序、抖音小程序、支付宝小程序、京东小程序
 */
export type PreloadRule = Record<string, PreloadRuleItem>
