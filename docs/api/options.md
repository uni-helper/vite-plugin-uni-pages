# 插件选项

`UniPages(options)` 接收一个可选的配置对象，所有字段都是可选的。

```ts
UniPages({
  dir: 'src/pages',
  subPackages: ['src/packages/account/pages'],
  exclude: ['**/node_modules/**', '**/__*__/**'],
})
```

## 基础选项

| 选项 | 类型 | 默认值 | 起始 | 说明 |
| --- | --- | --- | --- | --- |
| `dts` | `boolean \| string` | `true` | v0.2.9 | 是否生成 `uni-pages.d.ts`。字符串表示自定义路径，相对项目根目录 |
| `configSource` | `ConfigSource` | `'pages.config'` | v0.2.7 | 页面配置文件的加载来源，详见 [pages.config](../guide/pages-config.md#自定义配置来源) |
| `homePage` | `string \| string[]` | `['pages/index', 'pages/index/index']` | v0.1.9 | 没有页面标记 `type: 'home'` 时使用的首页路径 |
| `mergePages` | `boolean` | `true` | v0.1.0 | 是否扫描页面目录并合并到 `pages.json` |
| `dir` | `string` | `'src/pages'` | v0.1.0 | 主包页面目录，支持 glob |
| `subPackages` | `(string \| SubPackageConfig)[]` | `[]` | v0.1.8 | 分包目录，支持 glob 和 root 回调，详见[分包](../advanced/subpackages.md) |
| `outDir` | `string` | `'src'` | v0.0.1 | `pages.json` 所在目录，也是页面路径的计算基准 |
| `exclude` | `string[]` | `['**/node_modules/**', '**/.git/**', '**/__*__/**']` | v0.0.4 | 页面排除规则，详见[页面排除](../advanced/exclude.md) |

`subPackages` 的 glob 目录发现和 `root` 回调都在 v0.6 加入。

## 输出格式

| 选项 | 类型 | 默认值 | 起始 | 说明 |
| --- | --- | --- | --- | --- |
| `minify` | `boolean` | `false` | v0.1.6 | 压缩输出。会丢失注释，多平台条件下不要打开 |
| `indent` | `number \| string` | `2` | v0.5.0 | 缩进空格数或自定义字符串，`minify` 为 `true` 时忽略 |
| `eol` | `'\n' \| '\r\n'` | `'\n'` | v0.5.0 | 换行符 |
| `insertFinalNewline` | `boolean` | `false` | v0.5.0 | 是否在文件末尾追加换行 |

格式化选项的细节和跨平台限制见[输出格式](../advanced/formatting.md)。

## 调试

| 选项 | 类型 | 默认值 | 起始 | 说明 |
| --- | --- | --- | --- | --- |
| `debug` | `boolean \| DebugType` | `false` | v0.1.8 | 开启分类调试日志 |

`DebugType` 可选：

```text
hmr | options | pages | subPages | error | cache | declaration | definePage
```

也可以设置环境变量：

```shell
DEBUG=vite-plugin-uni-pages:*
```

## 生命周期钩子

钩子自 v0.0.3 起提供，v0.5.0 调整了参数。

| 钩子 | 参数 |
| --- | --- |
| `onBeforeLoadUserConfig` | 无 |
| `onAfterLoadUserConfig` | `pagesGlobConfig` |
| `onBeforeScanPages` | 无 |
| `onAfterScanPages` | `pages`, `subPages` |
| `onBeforeMergePageMetaData` | `pages`, `pagesGlobConfig` |
| `onAfterMergePageMetaData` | `pageMetaData`, `subPageMetaData` |
| `onBeforeWriteFile` | `filePath` |
| `onAfterWriteFile` | `filePath`, `content` |

触发顺序和示例见[生命周期钩子](./hooks.md)。

## 分包配置对象

```ts
interface SubPackageConfig {
  dir: string
  root: string | ((dir: string) => string)
}
```

`dir` 是相对 Vite root 的目录或 glob。`root` 是写进 `pages.json` 的根路径，可以用回调根据匹配到的目录计算。返回值为空、绝对路径、`.` 或包含 `..` 时会报错。`root` 回调自 v0.6 起支持。

## 完整类型

完整定义在 [`packages/core/src/types.ts`](https://github.com/uni-helper/vite-plugin-uni-pages/blob/main/packages/core/src/types.ts)。
