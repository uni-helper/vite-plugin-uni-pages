/**
 * 设置编译到 App（Harmony）平台的特定样式
 *
 * 相应的类型是 AppHarmony
 *
 * @desc App（Harmony）
 */
export interface AppHarmony {
  /**
   * 软键盘弹出模式，仅支持 "adjustResize" / "adjustPan"
   *
   * @default "adjustPan"
   */
  softInputMode?: 'adjustResize' | 'adjustPan'

  [x: string]: any
}
