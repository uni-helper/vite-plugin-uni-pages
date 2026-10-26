# 生命周期钩子

插件在生成流水线的固定阶段调用钩子。每个钩子只接收当前阶段的输入或输出，不传入 `PageContext`。

## 顺序

```text
onBeforeLoadUserConfig()
  加载用户配置
onAfterLoadUserConfig(pagesGlobConfig)
onBeforeScanPages()
  扫描主包和分包页面（mergePages 为 true 时）
onAfterScanPages(pages, subPages)
onBeforeMergePageMetaData(pages, pagesGlobConfig)
  合并页面元数据
onAfterMergePageMetaData(pageMetaData, subPageMetaData)
onBeforeWriteFile(filePath)
  写入 pages.json
  生成类型声明（启用时）
onAfterWriteFile(filePath, content)
```

`onAfterWriteFile` 只在 `pages.json` 内容实际变化时调用。`pages.json` 没变时，后面的声明文件仍会检查，但不会重复触发写入回调。

页面内容变化但元数据没变时，本次更新会提前结束，前面的加载和扫描钩子都不会触发。

## 用法

```ts
UniPages({
  onAfterScanPages(pages, subPages) {
    console.log(`主包 ${pages.size} 个页面`)
    for (const [dir, pagesInDir] of subPages) {
      console.log(dir, pagesInDir.size)
    }
  },
  onAfterMergePageMetaData(pages, subPackages) {
    console.log(pages.length, subPackages.length)
  },
  onAfterWriteFile(filePath, content) {
    console.log(`已写入 ${filePath}，${content.length} 个字符`)
  },
})
```

## 参数

| 钩子 | 参数说明 |
| --- | --- |
| `onAfterLoadUserConfig` | `pagesGlobConfig` 是配置文件导出的对象，没有有效配置时为 `undefined` |
| `onAfterScanPages` | `pages` 是主包页面映射，`subPages` 是分包目录到页面映射的映射 |
| `onBeforeMergePageMetaData` | 扫描结果和用户配置，适合在合并前读取 |
| `onAfterMergePageMetaData` | 最终写入的页面数组和分包数组 |
| `onAfterWriteFile` | `content` 是本次写入的完整文件文本 |

`pages` 中的 `Page` 实例提供 `path`、`uri`、`getPageMeta()` 等方法。钩子可以读取它们，但不建议在钩子里修改内部集合，后续阶段会重新扫描。

## 0.5.0 的变化

0.4.x 的钩子接收整个 `PageContext`。0.5.0 起改为按阶段传数据，部分钩子名称也调整了。迁移对照见[迁移指南](../other/migration.md)。
