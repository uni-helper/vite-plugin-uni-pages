# 迁移指南

## 从 0.5.x 升级到 0.6.0

0.6.0 调整了页面排除的基准、多个扫描声明指向同一批页面时的归属，以及一个插件实例能服务的 Vite 会话数量。只扫描默认目录、没有自定义 `exclude`、也没有多个扫描声明指向同一批页面的项目，通常不用改配置。用到自定义排除规则、多个目录或多条分包声明重叠，或者用 Vite JavaScript API 反复运行构建的项目，按下面的顺序检查。

从 0.4.x 或更早版本升级的项目，先完成下文「从 0.4.x 升级到 0.5.0」和「从 0.3.x 升级」两节，再回到这里。

### 破坏性变更

#### `exclude` 改为相对 Vite root

0.5.x 扫描页面文件时，`exclude` 相对每个实际扫描目录解释。0.6.0 统一以 Vite root 为基准，规则命中文件、目录或任一祖先目录时排除整个子树。

旧规则需要补上扫描来源的前缀。扫描 `src/pages`、`src/packages/*/pages` 和 `../shared/pages` 时，原来的 `exclude: ['index.vue']` 要改成：

```ts
exclude: [
  'src/pages/index.vue',
  'src/packages/*/pages/index.vue',
  '../shared/pages/index.vue',
]
```

这样仍只排除各扫描目录第一层的 `index.vue`。直接改成 `**/index.vue` 会连带排除嵌套的同名页面，也覆盖不到根外来源，不能当作等价写法。

| 0.5.x 写法 | 保留原扫描范围的迁移方式 |
| --- | --- |
| `internal/**` | 分别写 `src/pages/internal/**`、`src/packages/*/pages/internal/**`、`../shared/pages/internal/**` |
| `**/components/**` | 项目内保持原样，根外补 `../shared/pages/**/components/**` |
| `node_modules` | 分别写 `src/pages/node_modules`、`src/packages/*/pages/node_modules`、`../shared/pages/node_modules` |

默认值也从 `['node_modules', '.git', '**/__*__/**']` 变成 `['**/node_modules/**', '**/.git/**', '**/__*__/**']`，覆盖项目根子树里任意层的依赖目录。目录排除对静态分包同样生效，`!foo` 这类否定规则会直接报错。

页面放在依赖里的来源（pnpm link，或 workspace 包中 `dir: 'node_modules/@scope/ui/pages'` 这类写法）默认一条也扫不到。保留这类来源需要显式传入 `exclude`，例如 `exclude: []` 或 `exclude: ['**/__*__/**']`。

完整示例见[页面排除](../advanced/exclude.md)。

#### 扫描来源与页面归属

多个声明可以指向同一目录，也可以经符号链接指向同一页面。0.6.0 用已存在路径的 `realpath` 判断目录和页面身份，规则统一为：

- 同一页面归属同一分包 `root` 时只保留一份，主包和分包同时命中时由有效分包来源优先
- 同一目录的显式 `root` 优先于默认值，多个不同的显式值报错
- 同一物理页面经多个别名生成的多条路由收敛为一个代表来源，不再重复输出
- 同一页面被不同分包 `root` 认领、不同来源占用同一完整路由时报错，冲突结果不会写入 `pages.json`

静态目录共用同一 `root` 时，以前被后一个目录覆盖的页面会重新出现。不需要这些页面时，删除对应扫描声明或用 `exclude` 排除。需要解决冲突时，改扫描声明、分包 `root` 或 `definePage.path`，增加配置覆盖不能消除来源冲突。

完整规则见[分包](../advanced/subpackages.md#页面归属)。

#### 路径基准

- Vite `root` 在解析阶段固定为绝对路径，之后切换 `process.cwd()` 不再影响扫描、排除和输出位置
- `dts` 传字符串时相对 `root` 解析。0.5.x 按传入的字符串直接写文件，相对当前工作目录
- `getPageFiles(directory, options)` 的 `directory` 相对 `options.root` 解析，返回值仍相对 `directory`。直接调用这个函数的脚本需要检查传入的目录

#### 实例生命周期

一个 `UniPages()` 实例同时只服务一个 Vite 会话。以下用法现在会报错：

- 开发服务器还开着，又用同一实例启动构建
- 构建还没结束，又启动另一个构建
- `build --watch` 的 watcher 还没关闭，又启动新的构建或开发服务器
- `server.restart()` 复用同一实例，新服务器会在旧服务器关闭前创建

这些场景各自调用 `UniPages()` 创建实例。会话结束后的顺序复用不受影响，下一次使用会重新读取配置和页面。

细节见[会话与实例复用](../advanced/lifecycle.md)。

#### `UNI_PLATFORM` 必填

初始化时读不到 `process.env.UNI_PLATFORM` 会直接报错。0.5.x 会以空平台继续生成，条件编译分支全部被跳过，产物不对也不提示。通过 uni-app 的命令启动时这个变量总是存在，自行调用 `prepare()` 的脚本需要提前设置。

### 行为变化

以下变化不报错，但产物可能和 0.5.x 不同：

- `subPackages` 的字符串和对象 `dir` 都按 glob 解析。目录名里的 `[`、`]` 等元字符需要转义（`app\[prod\]`），否则会当成字符类
- 多平台 tabBar 条目按配置顺序摆放。配置覆盖全部既有条目时，其他平台新增的条目落在声明位置，不再追加到末尾
- 页面内容变化会重新读取标题、路由和 `definePage(null)` 状态，符号链接页面支持嵌套链接、删除重建和恢复。单轮来源发现最多登记 1024 个链接来源，超出后告警并跳过，页面扫描和 `pages.json` 生成不受影响
- 配置或依赖出现语法错误、文件缺失时，watch 模式保留上次成功生成的产物并报告错误；扫描来源冲突同样不会写入 `pages.json`

### 新能力

- `prepare()` 在 Vite 启动前完成一次生成，供工厂函数阶段读取 `pages.json` 的下游插件使用（[用法](../api/prepare.md)）
- `pages.config` 本地依赖热更新，修改被导入的模块会重新生成（[用法](../advanced/config-dependencies.md)）
- `subPackages` 目录 glob 自动发现，`root` 支持同步回调（[用法](../advanced/subpackages.md)）
- `@uni-helper/uni-pages-types` 补齐 uni-app x 字段，Schema 同步重新生成，改动均为新增

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

### 0.5.0 新能力

- `definePage(null)` 按平台跳过页面
- 函数式 `definePage` 和 `define().ifdef()/.ifndef()` 条件 DSL
- 过期分包自动清理
- tabBar 顶层属性按平台分别记录
- `indent`、`eol`、`insertFinalNewline` 格式化选项

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
