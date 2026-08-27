/**
 * 设置编译到 App（Harmony）平台的特定样式
 *
 * 相应的类型是 AppHarmony
 *
 * @desc App（Harmony）
 */
export interface AppHarmony {
  /**
   * 软键盘弹出模式
   *
   * "adjustResize" 重新测量并压缩布局尺寸
   *
   * "adjustPan" 整体平移窗口而不改变布局大小
   *
   * @default "adjustPan"
   */
  softinputMode?: 'adjustResize' | 'adjustPan'

  [x: string]: any
}
