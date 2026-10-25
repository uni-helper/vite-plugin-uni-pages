# 迁移指南

## 从 0.4.x 升级到 0.5.0

### 仅支持 ESM

移除了 `require` 条件导出，`main` 指向 `dist/index.mjs`。使用 CommonJS 引入的项目需要迁移到 ESM，例如把 Vite 配置改名为 `vite.config.mts`。

### Node.js 版本

要求 `^22.22.2 || ^24.15.0 || >=26.0.0`，随 `@babel/*` v8 升级。

仓库开发环境使用 Node 26，见根目录 `.node-version`。

### Babel 8

宏解析升级到 `@babel/parser` v8。import attributes 只支持 `with { ... }` 语法，旧的 `assert { ... }` 不再支持。带旧写法的页面会解析失败，退化为只有路径的页面配置，并输出警告。

### 生命周期钩子

钩子不再接收整个 `PageContext`，改为只接收对应阶段的数据：

| 0.4.x | 0.5.0 |
| --- | --- |
| `onBeforeLoadUserConfig(ctx)` | `onBeforeLoadUserConfig()` |
| `onAfterLoadUserConfig(ctx)` | `onAfterLoadUserConfig(pagesGlobConfig)` |
| `onBeforeScanPages(ctx)` | `onBeforeScanPages()` |
| `onAfterScanPages(ctx)` | `onAfterScanPages(pages, subPages)` |
| `onBeforeMergePageMetaData(ctx)` | `onBeforeMergePageMetaData(pages, pagesGlobConfig)` |
| `onAfterMergePageMetaData(ctx)` | `onAfterMergePageMetaData(pageMetaData, subPageMetaData)` |
| `onBeforeWriteFile(ctx)` | `onBeforeWriteFile(filePath)` |
| `onAfterWriteFile(ctx)` | `onAfterWriteFile(filePath, content)` |

### 依赖清理

`json5`、`yaml`、`detect-indent`、`detect-newline` 不再是运行时依赖。配置文件仍支持 `ts`、`mts`、`cts`、`js`、`cjs`、`mjs`、`json`，行为不变。

### 类型入口

包名的主 `types` 入口直指构建产物。只配置 `"types": ["@uni-helper/vite-plugin-uni-pages"]` 不再带入 `definePage` 全局和 `virtual:uni-pages` 模块声明，请改用 `/client` 子路径。

### 类型修正

以下改动不会产生 TypeScript 报错，但行为有差异：

- `app-plus` 的 `softInputMode`、`softInputNavBar` 更名为官方拼写 `softinputMode`、`softinputNavBar`，App-Harmony 同步更名
- `GlobalStyle` 移除 `disableScroll` 和 `disableSwipeBack`。官方文档注明这两个配置只在页面级 `style` 中有效，现在只保留在 `PageStyle` 上

### pages.json 硬错误

已存在的 `pages.json` 不是普通文件或缺少读写权限时，插件现在抛出错误，不再删除重建。0.4.x 会把它替换成占位内容，可能静默丢失手写内容。

### 路径基准

- Vite `root` 在解析阶段固定为绝对路径。之后切换 `process.cwd()` 不再影响扫描和排除结果
- `dts: true` 的默认输出路径相对解析后的 `root` 计算
- `getPageFiles(directory, options)` 的 `directory` 相对 `options.root` 解析，返回值仍相对 `directory`

## 从 0.3.x 升级

`<route>` 自定义块和 `routeBlockLang` 选项在 0.4.0 移除，0.3.24 起运行时会打印废弃提示。请改用 `definePage` 宏：

```vue
<!-- 旧写法 -->
<route lang="yaml">
style:
  navigationBarTitleText: 首页
</route>

<!-- 新写法 -->
<script setup lang="ts">
definePage({
  style: {
    navigationBarTitleText: '首页',
  },
})
</script>
```

## 页面排除规则迁移

0.5.0 之前 `exclude` 相对每个扫描目录解释，现在统一相对 Vite root。旧规则需要补上扫描来源的前缀，完整对照见[页面排除](../advanced/exclude.md#从旧版本迁移)。

## 扫描归属迁移

多个声明指向同一目录或符号链接时，0.5.0 后的行为：

- 共用同一 root 的静态目录会重新收录以前被覆盖的页面
- 同一目录的显式 root 优先于默认值
- 同一物理页面经多个别名生成的多条路由会收敛为一个代表来源
- 跨分包认领和同路由冲突改为明确报错

需要调整时，优先修改扫描声明、分包 root 或 `definePage.path`，仅增加配置覆盖不能消除来源冲突。详见[分包](../advanced/subpackages.md#页面归属)。

## 0.5.0 引入的能力

- `definePage(null)` 按平台跳过页面
- 函数式 `definePage` 和 `define().ifdef()/.ifndef()` 条件 DSL
- 过期子包自动清理
- tabBar 顶层属性按平台分别记录
- `indent`、`eol`、`insertFinalNewline` 格式化选项

## 0.5.0 之后的新能力

以下功能在 0.5.0 标签之后加入，升级前请确认版本：

- 多平台 tabBar 条目按配置顺序摆放
- 配置文件本地依赖热更新
- 分包 glob 和目录自动发现
- 统一的页面排除基准和页面归属规则
- 符号链接页面监听和恢复
- `prepare()` 提前生成
- 增量页面更新和会话复用

其中排除基准、扫描归属和路由冲突处理有行为变化，相关内容已在上面的迁移章节说明。
