export interface EasyCom {
  /**
   * 是否开启自动扫描，开启后将会自动扫描符合 `components/组件名称/组件名称.vue` 目录结构的组件
   *
   * @default true
   */
  autoscan?: boolean

  /**
   * 以正则方式自定义组件匹配规则
   *
   * 如果 `autoscan` 不能满足需求，可以使用 `custom` 自定义匹配规则
   *
   * @example
   * "custom": {
   *   "^uni-(.*)": "@/components/uni-$1.vue", // 匹配 components 目录内的 vue 文件
   *   "^vue-file-(.*)": "packageName/path/to/vue-file-$1.vue" // 匹配 node_modules 内的 vue 文件
   * }
}
   */
  custom?: Record<string, string>
}
