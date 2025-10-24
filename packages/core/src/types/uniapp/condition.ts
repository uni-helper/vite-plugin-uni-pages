export interface ConditionItem {
  /**
   * 启动模式名称
   */
  name: string

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
   * 当前激活的模式，list 节点的索引值
   */
  current: number

  /**
   * 启动模式列表
   */
  list: Partial<ConditionItem>[]
}
