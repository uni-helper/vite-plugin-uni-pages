# @uni-helper/vite-plugin-uni-pages

<p style="text-align: center">
  <a href="https://github.com/uni-helper/vite-plugin-uni-pages/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Stars"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/dm/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Downloads"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="NPM Version"></a>
</p>
<p style="text-align: center">
  <a href="https://github.com/kejunmao"><img src="https://img.shields.io/badge/Author-KeJun-blue?style=for-the-badge" alt="Author"></a>
  <a href="https://github.com/ModyQyW"><img src="https://img.shields.io/badge/Maintainer-ModyQyW-blue?style=for-the-badge" alt="Maintainer"></a>
</p>

使用 TypeScript 编写 `uni-app` 的 `pages.json`。支持约定式路由。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/vite-plugin-uni-pages"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

> **请考虑持续[赞助](https://github.com/ModyQyW/sponsors)以维持该项目的持续健康发展，非常感谢！🙏**

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

```ts
// vite.config.mts
import Uni from '@uni-helper/plugin-uni'
// 或
// import dcloudioUni from '@dcloudio/vite-plugin-uni'
// const Uni = dcloudioUni.default || dcloudioUni
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    UniPages(), // 需要在 Uni() 之前调用
    Uni(),
  ],
})
```

创建 `pages.config.(ts|mts|cts|js|cjs|mjs|json)`，然后用 TypeScript 编写你的 `pages.json`。你可以在创建的文件里使用 `#ifdef H5` 等条件编译语句。[👉 pages.config.ts 示例](../../playground/pages.config.ts)

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'

export default defineUniPages({
  // 你可以手动指定 pages，与 definePage 合并时，pages.config.ts 中的同名属性会覆盖 definePage。
  // 如果不手动指定 pages，插件会自动扫描页面并生成 pages.json。
  // pages: [],

  // 其它属性参考 pages.json，理论上一比一对齐
  // 如果发现没有对齐，请提交 issue，谢谢 🙏
  // https://uniapp.dcloud.net.cn/collocation/pages.html
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '@uni-helper',
  },
})
```

### 提前生成 pages.json

部分插件在工厂函数执行时读取 `pages.json`。这些场景可以在创建下游插件前等待 `prepare()`，确保它们拿到完整配置：

```ts
// vite.config.mts
import Uni from '@uni-helper/plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import Optimization from '@uni-ku/bundle-optimizer'
import { defineConfig } from 'vite'

export default defineConfig(async () => ({
  plugins: [
    await UniPages().prepare({ platformSuffix: false }),
    Uni(),
    Optimization(),
  ],
}))
```

数组按顺序求值，`Optimization()` 会在准备完成后才执行。也可以分步调用：

```ts
const pages = UniPages(options)
await pages.prepare({ platformSuffix: false })
```

`prepare()` 等待用户配置加载、页面扫描、合并、`pages.json` 和已启用的声明文件写入，成功后返回同一个插件实例。Vite 初始化会复用这份上下文。

| 参数 | 说明 |
| --- | --- |
| `root?: string` | 提前指定 Vite 项目根目录，默认使用 `VITE_ROOT_DIR` 或当前工作目录；相对路径以当前工作目录为基准 |
| `platformSuffix: boolean` | 必填，声明是否使用 UniPlatform 文件名后缀规则；启用 `@uni-helper/vite-plugin-uni-platform` 时传 `true`，其余场景传 `false` |

通过 uni-app 的开发或构建命令调用该配置。编译平台读取调用时的 `process.env.UNI_PLATFORM`；独立脚本需要提前设置它。准备阶段 Vite 尚未自动加载 `.env`，配置若依赖其中的变量，应先用 Vite `loadEnv()` 加载并提供所需环境。自定义 Vite `root` 时，向 `prepare()` 传入相同的根目录。

- 相同根目录、编译平台和后缀规则的并发或重复调用只初始化一次，成功后不会再次扫描。
- Vite 接管时会核对根目录、编译平台和 UniPlatform 状态，不一致会报错；接管后再次调用也必须保持一致。已经用 `prepare()` 指定过参数时，这个核对一直有效。
- 配置加载、文件写入或锁获取失败会拒绝 Promise，修复后可再次调用 `prepare()`。
- 准备前应完成源码与配置的创建；准备完成到文件监听建立之间的修改不保证被自动发现。

普通同步用法保持不变：可推导的输出目录已存在时，工厂会为缺失的 `pages.json` 创建占位文件，再在 Vite 初始化时完整生成。

只有一个插件实例、没有调用 `prepare()` 时，重复的 Vite 初始化不再报参数不一致：换了 `root` 或 `UNI_PLATFORM` 会按新参数重新扫描（嵌套构建、`build()` 复用一个实例都属于这种情形）。

占位文件只在能推导出的输出目录已经存在时创建。目录不存在时不在那个位置新建目录：`root` 优先取 `VITE_ROOT_DIR`，没设时取当前工作目录，而这个工作目录很可能不是真正的项目根，在它下面创建 `src` 会把目录建错地方。这时直接进行完整生成；如果 Vite 传入的 `root` 又是错的，生成会以 `ENOENT` 失败并指明路径。

`prepare()` 不会刷新下游插件已经缓存的配置，所以需要读取完整配置的插件应在等待完成后创建。

### 配置依赖热更新

`pages.config.ts` 可以拆分为本地模块。开发服务器和 `vite build --watch` 会监听配置入口及其直接、间接依赖；修改依赖后自动重新生成 `pages.json` 和类型声明。

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'
import { globalStyle } from './config/global-style'

export default defineUniPages({ globalStyle })
```

```ts
// config/global-style.ts
export const globalStyle = {
  navigationBarTitleText: '首页',
}
```

支持本地 TypeScript、JavaScript 和 JSON，以及静态 `import`、`export ... from`、字面量 `import()` / `require()` 形成的依赖链。新增导入后会更新监听集合，移除导入后该文件不再触发配置生成。纯类型导入不参与运行时依赖监听。

通过包名导入 workspace 包时，真实路径位于 `node_modules` 之外的源码也会参与加载、监听和重新求值，包括 Vite 根目录外的文件。已安装包的 TypeScript／JSON 入口及其相对依赖可以加载，但真实路径位于 `node_modules` 内的文件不参与自动监听；普通 JavaScript 包保持原有的 `import`／`require` 条件解析。

配置或依赖暂时出现语法错误、缺失文件时，watch 模式保留上次成功的产物并报告错误；修复后继续更新。已加载的配置入口删除后会使用空配置，重建入口后恢复加载。首次加载失败会终止初始化。

计算式动态导入、`fs.readFile()` 等运行时读取、`node_modules` 变更及应用的 `resolve.alias` 不在自动依赖监听范围内。自定义 `configSource.parser` 保持原有调用方式，其自行读取的文件不会自动加入依赖集合；`transform` 和 `rewrite` 的调用顺序保持不变。

### 页面级配置 definePage

在页面文件的 `<script setup>` 中使用 `definePage` 宏声明页面元数据：

```vue
<script setup lang="ts">
definePage({
  style: {
    navigationBarTitleText: '首页',
  },
  type: 'home', // 标记为首页
})
</script>
```

> `definePage` 必须写在 `<script>` 块的顶层，不要包进 `if`、`try` 等语句块里。插件只在块的顶层查找这个宏：写在里面的调用既读不到配置，也不会在构建时从代码里移除，运行时会报 `definePage is not defined`。

要让编辑器识别 `definePage` 全局宏，需要在项目的声明文件或 `tsconfig.json > types` 引用本包的 `/client` 类型。

<details>

  <summary> 声明文件简单示例 </summary>

  ```ts
  // env.d.ts
  /// <reference types="vite/client" />
  /// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
  ```

  ```json
  // tsconfig.json
  {
    "include": ["**/*.d.ts"]
  }
  ```

</details>

<details>

  <summary> tsconfig.json 简单示例 </summary>

  ```json
  // tsconfig.json
  {
    "types": ["@uni-helper/vite-plugin-uni-pages/client"]
  }
  ```

</details>

自 0.5.0 起，`definePage` 支持函数式写法，接收 `{ platform, define }` 上下文（详见 [平台条件页面配置](#平台条件页面配置)）：

```vue
<script setup lang="ts">
definePage(({ platform, define }) =>
  define({
    style: { navigationBarTitleText: '首页' },
  })
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    .ifndef('h5', { middlewares: ['auth'] }),
)
</script>
```

自 0.5.0 起，返回（或直接传入）`null` 表示当前平台不注册该页面：

```vue
<script setup lang="ts">
definePage(({ platform }) => {
  // 仅小程序注册该页面
  if (platform === 'h5')
    return null
  return { style: { navigationBarTitleText: '仅小程序' } }
})
</script>
```

宏的参数里可以引用页面文件顶部导入的值（普通 `<script>` 块里的导入也算），插件在构建时会把这些导入一起执行；宏参数没用到的导入（比如组件的导入）不会被执行：

```vue
<script setup lang="ts">
import { TITLE } from './title.mjs'

definePage({
  style: { navigationBarTitleText: TITLE },
})
</script>
```

> 导入路径要写全扩展名（`./title.mjs`、`./title.ts` 都可以）。TS 里习惯的省略扩展名写法（`./title`）在这里不行——宏代码在构建期用 Node 的 `require` 执行，它不做 TS 的扩展名补全。

### 平台条件页面配置

自 0.5.0 起，函数式 `definePage` 注入的 `define` 工厂提供条件 DSL，无需手动读取 `process.env.UNI_PLATFORM`：

- `define(base)`：所有平台共享的基础元数据
- `.ifdef(platforms, partial)`：仅在列出的平台生效
- `.ifndef(platforms, partial)`：在列出的平台之外的所有平台生效
- 匹配的分支按声明顺序深合并进 `base`：对象递归合并，数组与原始值直接替换
- `h5` 与 `web` 是同一平台的别名，分支中写任意一个即同时覆盖两者
- `platform` 为当前构建的平台标识（如 `'mp-weixin'`、`'h5'`）

```vue
<script setup lang="ts">
definePage(({ define }) =>
  define({
    style: { navigationBarTitleText: '标题', enablePullDownRefresh: false },
  })
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    .ifndef(['h5', 'web'], { middlewares: ['auth'] }),
)
</script>
```

条件定义在扫描阶段即按当前平台解析为普通对象，最终写入 `pages.json` 的仍是平台无关的标准结构；多终端并发时各平台的差异由插件按条件编译块合并（见 [多终端并发开发](#多终端并发开发)）。

你也可以导入 [虚拟模块](https://v5.vite.dev/guide/api-plugin.html#virtual-modules-convention) 来访问所有页面的元数据。

> 注意：虚拟模块的导出不保证稳定，可能会在小版本中出现变化。

<details>

  <summary> 虚拟模块使用简单示例 </summary>

  ```ts
  /// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
  import { pages } from 'virtual:uni-pages'

  console.log(pages)
  ```

</details>

## 插件配置

```ts
interface UserOptions {
  /**
   * 生成页面路径的 TypeScript 类型声明
   * 为 true 时在项目根目录生成 uni-pages.d.ts
   * 为 string 时作为自定义输出路径（相对于项目根目录）
   * @default true
   * @since 0.2.9
   */
  dts?: boolean | string

  /**
   * 页面配置文件的加载源
   * 基于 unconfig，支持多配置源合并
   * @default 'pages.config'
   * @since 0.2.7
   */
  configSource?: ConfigSource

  /**
   * 默认应用入口页面（首页）
   * 当没有页面通过 definePage({ type: 'home' }) 标记为首页时使用
   * 支持多个路径样式以兼容不同的目录结构
   * @default ['pages/index', 'pages/index/index']
   * @since 0.1.9
   */
  homePage?: string | string[]

  /**
   * 是否自动扫描目录并合并页面配置到 pages.json
   * 关闭后仅加载用户配置文件，不扫描文件系统
   * @default true
   * @since 0.1.0
   */
  mergePages?: boolean

  /**
   * 主包页面的搜索目录
   * 支持 glob 模式，如 'src/{pages,views}'
   * 最终结果由 tinyglobby 解析为匹配的目录列表
   * @default 'src/pages'
   * @since 0.1.0
   */
  dir?: string

  /**
   * 分包页面目录的根目录列表
   * 用于 uni-app 的分包加载功能
   * 字符串和对象的 dir 均支持 glob，root 可通过同步回调计算
   * 更多上下文参考 <https://github.com/uni-helper/vite-plugin-uni-pages/issues/271>
   * @default []
   * @since 0.1.8
   */
  subPackages?: (string | { dir: string, root: string | ((dir: string) => string) })[]

  /**
   * pages.json 所在目录
   * 相对于项目根目录，也是计算页面相对路径的基准
   * @default 'src'
   * @since 0.0.1
   */
  outDir?: string

  /**
   * 页面排除的文件或目录模式
   *
   * @description
   * - 相对模式基于 Vite root，绝对模式直接匹配对应路径；命中目录时排除整个子树
   * - 主包、分包的扫描与页面事件使用相同规则
   * - 自定义数组替换默认值，空数组禁用默认页面排除，空字符串忽略
   * - 不接受 `!foo` 否定规则，`!(keep).vue` 等 extglob 有效
   *
   * @default ['**\/node_modules/**', '**\/.git/**', '**\/__*__/**']
   * @since 0.0.4
   */
  exclude?: string[]

  /**
   * 是否压缩生成的 pages.json
   * @default false
   * @since 0.1.6
   */
  minify?: boolean

  /**
   * 是否在 pages.json 末尾插入换行
   * @default false
   * @since 0.5.0
   */
  insertFinalNewline?: boolean

  /**
   * 生成的 pages.json 的缩进
   * 接受空格数量或字符串（如 `'\t'`）
   * 当 `minify` 为 `true` 时被忽略
   * @default 2
   * @since 0.5.0
   */
  indent?: number | string

  /**
   * 生成的 pages.json 的换行符
   * 自 0.5.0 起提供
   * @default '\n'
   */
  eol?: '\n' | '\r\n'

  /**
   * 启用调试日志
   * 为 true 时启用所有分类；为字符串时仅启用特定分类
   * 可选分类：hmr | options | pages | subPages | error | cache | declaration | definePage
   * 也可通过环境变量 DEBUG=vite-plugin-uni-pages:* 控制
   * @default false
   * @since 0.1.8
   */
  debug?: boolean | DebugType

  // 生命周期钩子，在每个阶段前后触发，仅接收该阶段的输入或输出数据
  // 自 v0.0.3 起提供；0.5.0 起签名由 (ctx: PageContext) 改为按阶段传入数据，见「0.5.0 破坏性变更」
  onBeforeLoadUserConfig?: () => void
  onAfterLoadUserConfig?: (pagesGlobConfig: PagesConfig | undefined) => void
  onBeforeScanPages?: () => void
  onAfterScanPages?: (pages: Map<string, Page>, subPages: Map<string, Map<string, Page>>) => void
  onBeforeMergePageMetaData?: (pages: Map<string, Page>, pagesGlobConfig: PagesConfig | undefined) => void
  onAfterMergePageMetaData?: (pageMetaData: InternalPages, subPageMetaData: SubPackages) => void
  onBeforeWriteFile?: (filePath: string) => void
  onAfterWriteFile?: (filePath: string, content: string) => void
}
```

### 流程说明

插件内部按以下顺序执行生命周期，每个阶段对应一个生命周期钩子：

```text
加载用户配置 → 扫描页面文件 → 合并页面元数据 → 生成并写入 pages.json
```

1. **加载用户配置**：通过 `unconfig` 加载 `pages.config.ts` 等配置文件，获取手动指定的页面元数据（`pages`、`subPackages`、`globalStyle` 等）
2. **扫描页面文件**（仅在 `mergePages: true` 时）：根据 `dir` 和 `subPackages` 扫描文件系统，为每个页面文件创建 `Page` 实例
3. **合并页面元数据**：将扫描到的页面与用户配置中的页面元数据合并。优先级从低到高：

   - `globalStyle`（`pages.config.ts` 中的全局样式）
   - `definePage()`（`.vue` 文件中通过宏定义的页面配置）
   - `pages.config.ts` 中 `pages` 数组里对应 path 的条目（最高优先级，会覆盖 `definePage` 的同名属性）

4. **生成并写入**：序列化为 `pages.json`，写入到 `outDir` 目录，并生成 TypeScript 类型声明

### 配置示例

```ts
// vite.config.mts
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    UniPages({
      dts: 'src/typings/uni-pages.d.ts', // 自定义类型声明路径
      dir: 'src/{pages,views}', // 多目录扫描
      subPackages: ['src/sub-package-a', 'src/sub-package-b'],
      exclude: ['**/node_modules/**', '**/.git/**', '**/__*__/**', '**/components/**'],
      minify: true,
      debug: true, // 或 debug: 'pages'
      onAfterScanPages(pages) {
        console.log(`扫描到 ${pages.size} 个主包页面`)
      },
    }),
  ],
})
```

### 页面排除规则

`exclude` 的相对模式统一基于 Vite `root`，绝对模式直接匹配对应路径。任一规则命中文件、目录或其祖先目录时，都会排除对应页面及整个目录子树。主包、字面分包、glob 分包以及固定或回调 `root` 的分包使用相同规则，首次扫描和后续页面事件的判断也一致。实际扫描目录、`outDir` 和分包 `root` 不改变排除基准。

例如 Vite `root` 为 `/workspace/app`：

| `exclude` 项 | 排除范围 |
| --- | --- |
| `index.vue` | `/workspace/app/index.vue` |
| `src/pages/index.vue` | 指定的项目内页面 |
| `**/index.vue` | 项目根子树中各层的同名页面 |
| `src/packages/internal` | 该目录及整个子树 |
| `../shared/pages/**/index.vue` | 根外 `shared/pages` 中各层的同名页面 |
| `/workspace/shared/pages/internal` | 指定的绝对路径及其子树 |

`**` 不跨过前导 `../`，因此 `**/index.vue` 不会排除 `../shared/pages/index.vue`。根外目录需要显式写出前缀。默认值为 `['**/node_modules/**', '**/.git/**', '**/__*__/**']`，同样只覆盖项目根子树；需要排除根外的依赖目录时，应补充 `../shared/pages/**/node_modules/**` 等规则。

显式提供 `exclude` 会替换默认值。`exclude: []` 禁用默认页面排除，底层 watcher 的固有忽略仍然生效。完全为空的字符串会被忽略，路径中的空格会保留；`!foo` 这类否定规则会报错，`!(keep).vue` 这类 extglob 仍可使用。

页面排除控制自动发现的页面及其变更处理。被排除目录中的合法配置入口或配置依赖仍会参与配置加载和更新。插件收到事件后的排除结果保持一致，实际能否收到文件系统事件仍受 watcher 后端及其配置限制。

#### 迁移已有规则

旧版本的文件扫描把 `exclude` 解释为相对每个实际扫描目录。统一到 Vite `root` 后，需要为这类旧规则补齐扫描来源的前缀。例如扫描 `src/pages`、`src/packages/*/pages` 和 `../shared/pages` 时，旧的 `exclude: ['index.vue']` 应迁移为：

```ts
exclude: [
  'src/pages/index.vue',
  'src/packages/*/pages/index.vue',
  '../shared/pages/index.vue',
]
```

这保留了仅排除各扫描目录第一层 `index.vue` 的范围。直接改为 `**/index.vue` 会额外排除嵌套的同名页面，且仍不覆盖根外来源，不能作为等价迁移。

| 原写法 | 保留原文件扫描范围的迁移方式 |
| --- | --- |
| `internal/**` | 分别写 `src/pages/internal/**`、`src/packages/*/pages/internal/**`、`../shared/pages/internal/**` |
| `**/components/**` | 项目内保留原写法，根外补 `../shared/pages/**/components/**` |
| `node_modules` | 分别写 `src/pages/node_modules`、`src/packages/*/pages/node_modules`、`../shared/pages/node_modules` |

默认值也从 `node_modules`、`.git` 改为项目根子树中各层的目录模式，扩大了项目内的默认排除范围。目录排除现在对所有扫描形式生效，静态分包也会排除命中的目录。

默认值也会命中扫描目录本身。把页面写在依赖里的来源（例如 pnpm link 或 workspace 包中的 `dir: 'node_modules/@scope/ui/pages'`，以及指向同类路径的 `subPackages`）会被默认排除，一条页面都扫不到。保留这类来源需要显式传入 `exclude`，比如关闭默认页面排除的 `exclude: []`，或只留下还需要的那部分规则（如 `exclude: ['**/__*__/**']`）。

### 路径基准

页面相关的路径基准在同一次调整中统一，升级前请确认以下三点：

- Vite `root` 在解析阶段固定为绝对路径（相对 `process.cwd()` 传入时也会解析），之后切换 `process.cwd()` 不再影响扫描和排除结果。
- `dts: true` 的默认输出路径相对解析后的 `root` 计算；此前相对传入的 Vite root，未传时是 `process.cwd()`。
- `getPageFiles(directory, options)` 的 `directory` 相对 `options.root` 解析（此前相对 `process.cwd()`），返回值仍相对 `directory`。

### 完整类型定义

请查看 [types.ts](./src/types.ts) 获取完整定义。

## FAQ

### 这个插件写入配置晚于 uni-app 读取配置，导致无法正常运行

`@dcloudio/vite-plugin-uni` 在 Vite 的 `config` 钩子里通过 `parsePagesJsonOnce` 读取 `pages.json`，而本插件在更晚的 `configResolved` 钩子里才写入。

`config` 早于 `configResolved`，所以即便本插件设置了 `enforce: 'pre'`，也只能在 `configResolved` 内部抢先，无法早于 `config` 钩子。`parsePagesJsonOnce` 结果被 `once` 缓存，首次读取后即固定，后续写入对 uni-app 无效。

核心矛盾是时序：必须在 uni-app 进程启动前把 `pages.json` 生成好。以下按推荐度排序给出方案。

#### 方案一（推荐）：使用 [@uni-helper/unh](https://uni-helper.cn/unh/auto-generate)

`unh` 在调用 `uni dev/build` 前加载配置、扫描页面并写盘，再 spawn 子进程，天然解决时序问题。

```jsonc
// package.json
{
  "scripts": {
    "dev": "unh dev",
    "build": "unh build"
  }
}
```

```ts
// unh.config.ts
import { defineConfig } from '@uni-helper/unh'

export default defineConfig({
  autoGenerate: {
    pages: true, // 在 dev/build 前自动生成 pages.json
  },
})
```

#### 方案二：自行编写脚本，在 uni 命令前生成

如果不想引入 `unh`，可以自行编写脚本在 `uni` 命令前生成 `pages.json`，再用 `&&` 串联或 npm `predev`/`prebuild` 钩子触发。脚本需要复刻本插件的完整流水线（加载 `pages.config.ts`、扫描页面文件、解析 `definePage` 宏、合并元数据），维护成本较高，故优先推荐方案一。

### 支持 JSX/TSX 吗？

不支持，只支持 vue/nvue/uvue 文件。

### 文件名有限制吗？

文件名内不能带有额外的 `.` 分隔符，如 `index.v1.vue` 不合法。这是小程序的限制，并非本插件的限制。

### 如何自动发现分包？

`subPackages` 的字符串和对象 `dir` 都支持目录 glob。例如，`subPackages: ['src/packages/*/pages']` 会把每个匹配的 `pages` 目录作为分包目录，生成的默认 `root` 相对 `outDir` 计算。每条规则的匹配结果按路径排序，规则之间保留配置顺序。

`dir` 和 `subPackages` 的值一律按 glob 模式解析，字面目录名里的 glob 元字符也按模式解释。目录名为 `app[prod]` 时写成 `app\[prod\]/src/pages`；不转义的 `[prod]` 是字符类，会匹配到 `appp` 这类目录名，写成绝对路径时还可能一个目录都匹配不到。

如需让分包 `root` 指向扫描目录的上级，可以使用同步回调：

```ts
import { posix } from 'node:path'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

UniPages({
  subPackages: [{
    dir: 'src/packages/*/pages',
    root: dir => posix.relative('src', posix.dirname(dir)),
  }],
})
```

对于 `src/packages/account/pages/profile.vue`，回调收到 `src/packages/account/pages`，生成：

```json
{
  "subPackages": [{
    "root": "packages/account",
    "pages": [{ "path": "pages/profile" }]
  }]
}
```

回调参数始终相对 Vite 项目 `root`，使用 `/` 分隔且不带末尾斜杠；传入绝对 glob 时也遵守这一规则。返回值必须是非空相对路径，不能是 `.`、绝对路径或包含 `..`。每次重新发现目录时都会调用回调，不能返回 Promise。

目录与路径规则：

- 同一物理目录的固定值和回调结果都是显式 `root`，优先于未填写 `root` 的默认值；多个显式值相同可以合并，不同则报错
- 多个目录得到同一 `root` 时统一聚合页面，静态目录、glob、回调和混合写法遵守相同规则
- 排除目录或文件使用 `exclude`；`subPackages` 不接受以 `!` 开头的否定规则
- 字符串形式的自定义 `root` 保留既有路径计算规则；设置 `root` 不会移动页面文件

H5 开发服务器和 `vite build --watch` 都会重新发现主包 `dir` 与分包目录，支持启动时目录尚不存在，以及运行中的新增、删除、重命名和重建。空目录会被发现，在包含页面之前不生成空分包。目录可以位于 Vite 项目根目录之外，路径仍相对 Vite `root` 解析，不受命令执行目录影响。`mergePages: false` 时不扫描或监听页面目录；H5 的监听范围仍受 Vite `server.watch` 配置约束。

Windows 下，原生监听会持有子目录句柄，重命名其父目录可能报 `EPERM`，详见 [Chokidar #1380](https://github.com/paulmillr/chokidar/issues/1380)。需要在运行期间重命名这类目录时，可在启动命令前设置环境变量 `CHOKIDAR_USEPOLLING=true`，为 H5 和 `build --watch` 启用 [Chokidar 轮询后端](https://github.com/paulmillr/chokidar/blob/5.0.0/README.md#performance)。页面内容与恢复入口使用相同的轮询设置，`CHOKIDAR_INTERVAL` 可指定轮询间隔（毫秒）；H5 也支持 Vite 的 `server.watch.usePolling` 和 `server.watch.interval`。轮询会增加 CPU 和文件系统访问开销，插件不会默认启用。

Vite 的 `server.watch.ignored` 同样约束 H5 的页面监听。相对字符串规则按 watcher 的 `cwd` 解析；未设置 `cwd` 时与 Chokidar 一致按 `process.cwd()` 展开，`**/` 开头的规则仍匹配任意绝对路径，`!` 否定规则在解析后保留否定语义。`server.watch.awaitWriteFinish` 和 `server.watch.atomic` 会转发给页面内容 watcher，与 Vite 自身的监听行为保持一致。

动态发现会更新 `pages.json`。如果下游插件只在创建时缓存分包信息，它仍需要重启才能使用新增分包；自动重新发现不会改变其他插件的缓存策略。

### 扫描目录与页面归属

多个扫描声明可以指向同一目录，也可以通过符号链接指向同一页面。插件使用已存在路径的 `realpath` 判断目录和页面身份，不合并硬链接。身份判断不改变路径基准：`exclude` 仍匹配各来源的词法路径，`root` 回调仍收到相对 Vite `root` 的匹配路径，输出路径仍从选中的来源路径计算。

同一物理目录先确定分包 `root`，但保留全部来源用于文件排除。例如 alias 和真实目录都被扫描，只有 alias 下的 `foo.vue` 被排除时，真实目录下未被排除的同一文件仍可贡献页面。目录级排除会移除该目录来源；仅排除其中的文件不会撤销该目录的显式 `root` 意图。

页面归属遵守以下规则：

- 同一页面归属同一分包 `root` 时只保留一份；主包和分包同时命中该页面时由有效分包来源优先
- 同一有效页面被不同分包 `root` 认领时报错，错误中列出相关来源和声明
- `definePage(null)` 及现有平台规则跳过的页面不参与页面归属和生成路由冲突；目录声明的显式 `root` 冲突仍会报错
- 代表页面优先从未被排除、当前平台有效的显式来源中选择，其余按声明顺序选择；每条 glob 内按匹配路径排序。没有显式 `root` 时，默认值也按此稳定顺序选择

交换声明顺序可能改变代表路径、默认 `root`、页面顺序及最终路由，但不会因为提前丢弃其他别名来源而漏掉有效页面。不存在的目录不创建物理身份；原始声明和稳定祖先监听仍保留，目录出现后重新解析。空目录或零匹配的 glob 不会改变其他目录按 `root` 聚合的方式。

不同生成来源占用同一完整路由时会报错，包括主包与分包碰撞，以及通过 `.`、`..`、分隔符或末尾斜杠表达的同一路由。比较时会规范化路径，输出仍沿用原有路径换算。已有 `.vue`、`.nvue`、`.uvue` 格式覆盖和主包平台变体规则在原适用范围内保留；不会将主包平台后缀规则推广到分包，也不会因文件族相同而放过不同分包之间的路由冲突。

`pages.config` 中的同路由条目是元数据覆盖：先按 `root` 聚合全部扫描页面，再合并配置，未覆盖的扫描字段、手工页面、`plugins` 和仅有配置的分包均保留。扫描来源冲突在配置覆盖前检查，不能用配置中的同名条目掩盖；冲突发生时不会把冲突结果写入已有 `pages.json`。

#### 迁移重复扫描声明

以下变化以统一扫描归属前的主分支为比较基准；分包 glob 尚未进入正式版 `0.5.0`。

- 静态目录共用同一 `root` 时，过去被后一个目录覆盖的页面现在会重新出现；若这些页面不需要参与生成，应删除相应扫描声明，或用 `exclude` 排除文件、目录
- 同一目录同时配置默认和显式 `root` 时，改为显式值优先；多个不同显式值仍需统一或移除重复声明
- 同一物理页面经多个别名生成的多条路由会收敛为一个代表来源，可通过调整有效显式来源和声明顺序确定保留的词法路径
- 同一页面跨分包认领、不同生成文件占用同一完整路由时，改为明确报错；需要调整扫描范围、分包归属或 `definePage.path`，仅增加配置覆盖不能消除来源冲突

扫描入口会递归收录页面。同时声明 `src/pkg-a` 与 `src/pkg-a/pages`，或一条 `src/pkg-a/**` 同时匹配二者时，子目录页面可能被不同 `root` 重复认领；错误会列出原始规则、匹配目录及分包 `root`。整棵目录属于一个分包时，只声明 `subPackages: ['src/pkg-a']` 即可保留父、子目录的页面；确需多个入口且属于同一分包时，可以统一 `root`，例如 `{ dir: 'src/pkg-a/**', root: 'pkg-a' }`。

`exclude` 按词法路径过滤，对所有扫描入口生效。例如，`exclude: ['src/pkg-a/pages']` 也会排除父目录递归扫描到的 `pages/index.vue`，不能只撤销子目录那条扫描声明。需要保留页面、只消除重复认领时，应调整扫描声明或统一分包 `root`；不需要页面时再排除文件、目录。仅删除一条声明，其他入口仍可能收录该页面。

格式覆盖例外按真实文件族判断。例如，真实 `shared.vue` 与指向无扩展名文件的 `shared.nvue` 别名同占 `shared` 路由，此前主分支可能只留下一个结果，现在因不同物理来源不满足真实文件族条件而报冲突，需调整扫描范围或页面路由。单独扫描这个 `shared.nvue` 别名仍可收录页面，不会仅因真实目标没有扩展名而被拒绝。

### 页面内容与符号链接监听

页面文件、目录的新增和删除，以及页面内容 watcher 首次 `ready` 后的补扫，都会重新读取当前页面内容。同路径快速删除重建也会刷新标题、路由和 `definePage(null)` 状态。普通 `change` 只重读该物理文件关联的缓存候选，其他页面继续复用内容缓存，包括归属决议中未被选为代表的来源。普通 `change` 下页面元数据未变时，跳过配置加载与产物生成；元数据变化时仍扫描页面清单、校验归属与路由冲突，再合并产物。读取失败时保留上次成功配置，后续变更或整轮补扫可以重试。

已收录的符号链接页面可以通过词法路径或真实目标路径的事件更新。事件按当前有效的词法来源检查 `exclude` 和扫描规则，再重新计算页面归属；物理目标的位置不改变排除或输出路径的基准。

页面来源目录内部的嵌套符号链接也参与目标发现和恢复。链接指向空目录、尚未创建的目录或另一层链接时，插件仍保留当前入口关系；目标创建后会发现页面并继续监听内容。嵌套链接只补充当前来源的监听依赖，不改变主包、分包的声明和输出路径。

例如 `src/pages/feature` 指向外部 `shared/pages`：启动时目标不存在，稍后创建 `shared/pages/profile.vue` 会自动加入页面；运行中将 `feature` 改指另一目录后，新目录的后续页面修改也会更新产物。两个有效入口共用同一目标时，移除其中一个入口仍保留另一入口所需的订阅；最后一个有效入口退出后才释放目标。多层链接按各自的词法路径应用排除规则，同一遍历链路遇到已访问的物理目录时停止展开循环，其他独立别名继续参与发现。

监听目标统一换算为真实路径后再用于订阅和事件身份比较；词法路径仍用于 `exclude`、输出和诊断。这样同一个目标的 Unicode 规范化或大小写拼写差异不会导致事件无法映射。目标路径中暂时不可读的部分按“暂不可用来源”处理：本轮跳过该来源的监听，但页面扫描和产物生成继续；权限恢复后，后续完成刷新或重新扫描时再重新发现。链接自身在解析期间被删除或改指时也按悬空目标处理，下一轮刷新会重新解析。页面监听初始化失败只记录错误，不阻断页面生成，并会在后续生成时重试。

#### Vite 配置与模块热更新

普通非循环页面链接无需额外配置。UniPages 自行发现链接、解析真实目标并建立页面监听；Vite 的共享监听负责模块更新与 HMR，两条更新路径需要分别判断。

以下两项均为 Vite 配置，分别控制文件监听和模块解析，按项目需要设置：

| 配置 | 默认值 | 职责 |
| --- | --- | --- |
| `server.watch.followSymlinks` | `true` | 控制监听器是否沿符号链接覆盖目标 |
| `resolve.preserveSymlinks` | `false` | 控制模块身份是否保留链接路径；默认使用解析后的真实路径 |

#### 循环链接的可选处理

仅当循环链接导致 Vite 共享 watcher 报 `ELOOP` 时，才考虑在 H5 开发中关闭链接递归。该问题已在未启用 UniPages 的对照中复现，下面是 Vite 监听层的可选规避措施：

```ts
export default defineConfig({
  server: {
    watch: { followSymlinks: false },
  },
  plugins: [UniPages()],
})
```

`followSymlinks` 作用于整个共享 watcher，可能影响链接模块的 HMR 和依赖它的其他插件。实际影响取决于模块解析路径及真实目标是否另行受到监听，调整后应验证项目中的模块热更新。

项目采用 `preserveSymlinks: true` 保留链接路径时，关闭 `followSymlinks` 后应特别验证链接模块的 HMR。页面配置恢复成功不能证明模块热更新正常。

<details>
<summary>HMR 实测结果与验证范围</summary>

验证环境为 Vite 5.4.21、macOS，使用 Vue 插件加载项目外链接的 Vue 页面和独立 JS 模块。Node watcher 与 FSEvents 两种后端得到相同结果：

| `followSymlinks` | `preserveSymlinks` | Vue 模板与 JS 模块更新 | `pages.json` 元数据 |
| --- | --- | --- | --- |
| `false` | `true` | 无 HMR 更新消息，再次请求模块转换代码仍是旧内容 | 正常更新 |
| `false` | `false`（默认值） | HMR 更新消息与转换代码正常更新 | 正常更新 |

这些结果只描述该验证场景，不构成其他配置组合或默认配置的 HMR 保证。核验范围为服务端消息和转换代码，未覆盖浏览器渲染、样式 HMR、Windows、Linux、polling、其他 Vite 版本或其他插件行为。

页面监听回归（含循环链接场景）验证页面发现、配置生成、监听订阅与恢复。私有页面 watcher 未向 Vite 转发全部页面事件；普通 `change` 下元数据未变时，生成逻辑会提前返回。

</details>

#### 来源恢复与订阅

当前配置中的词法来源决定页面范围，符号链接的当前指向决定内容目标。来源暂时不可用时，插件观察恢复所需的目录入口；仍指向已删除目标的链接可以在目标重建后恢复。确认链接改指另一个目标时，旧目标会退出该来源的关联与订阅，新目标尚不存在时也按新指向等待恢复。链接自身删除后，恢复时重新解析其当前指向。

页面来源可以直接位于 `node_modules` 内，也可以链接到其中。这类路径是否参与监听由 `exclude` 和 Vite 忽略规则按词法来源决定，插件不会额外按 `node_modules`、`.git` 路径片段跳过。默认 `exclude` 仍会排除依赖目录，保留这类来源时需要显式放开，例如 `exclude: []`。

页面文件事件统一由插件独立持有的页面监听器处理。内容订阅使用解析后的物理路径，不递归跟随链接；所有有效词法来源共同决定订阅集合。共享目标只订阅一次，父目录已经覆盖的子目录和文件目标不重复注册，目录之外的文件别名单独订阅实际文件。恢复观察采用非递归的目录入口监听，不会将公共祖先下的兄弟项目加入递归监听；恢复或切换目标后会收回不再需要的订阅。H5 开发服务器和 `build --watch` 使用相同的页面监听机制。共享 watcher 提供配置文件事件和有效页面目录的结构通知；Vite 的共享 watcher 保持由 Vite 管理，构建模式的配置 watcher 按解析后的依赖路径注册，不递归跟随页面链接。恢复以能够从来源路径解析出的链接指向为依据。

页面事件在生成期间到达时合并到下一轮。同一待处理批次中的多个普通内容变更只重读各自关联的缓存候选；批次中包含新增、删除、目标切换或恢复等结构变化时，执行完整刷新。

编辑器通过临时文件重命名覆盖页面时，文件目标的内容监听负责接续替换后的文件。被识别为普通内容变更的事件只重读关联页面；原子保存产生的新增、删除事件或后端目录通知，也可能触发来源发现或结构刷新。

监听来源发现会遍历声明的页面目录，并在同一轮内复用物理目录读取。普通 `change` 下元数据未变时，生成逻辑提前返回；元数据变化后继续生成，以及新增、删除、改指、恢复和 `ready` 补扫等结构刷新时，都会重新发现监听来源。这些是分别可能触发的场景，不能将所有保存都视为普通 `change`。

每次来源发现创建独立的词法路径排除查询，复用本轮路径及共同祖先的 `exclude` 匹配结果，遍历结束后释放。该复用减少重复规则匹配，不缓存文件系统状态或 Vite `ignored` 的判断结果，也不减少目录读取或省略扫描。

页面清单通过 glob 遍历目录，监听依赖发现另有一次目录遍历。当两次遍历覆盖同一目录树时，目录读取约多一遍；这不表示每次保存都会增加遍历，也不表示整条生成链的耗时翻倍。评估性能时需要同时观察页面清单扫描、监听来源发现和完整生成链路。

单轮来源发现最多登记 1024 个链接来源。别名层叠会让同一物理目录经多条词法路径重复展开；达到上限后本轮停止继续展开链接并告警，页面扫描和 `pages.json` 生成不受影响，但超出上限的来源本轮不会建立内容监听。需要完整覆盖时，收窄 `dir`／`subPackages` 或通过 `exclude` 移除不再使用的链接；后续刷新会按调整后的范围重新发现。

### 支持 monorepo 吗？

在 monorepo 项目中，如果页面分布在多个 package 中，可以使用 `subPackages` 配置的对象格式来自定义生成的 `root` 路径。

```ts
// vite.config.mts
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    UniPages({
      subPackages: [
        // 简写格式（原有功能）
        'src/pages-sub',
        // 对象格式（monorepo 支持）
        {
          dir: '../../packages/login/src/pages', // 页面目录路径
          root: 'packages/login/src/pages', // 自定义 pages.json 中的 root
        },
        {
          dir: '../../packages/user/src/pages',
          root: 'packages/user/src/pages',
        },
      ],
    }),
  ],
})
```

这样生成的 `pages.json` 中 `subPackages.root` 将使用自定义的值，而不是基于文件系统计算的相对路径，避免出现 `..` 造成路径问题。

更多上下文参考 <https://github.com/uni-helper/vite-plugin-uni-pages/issues/271>。

## 0.5.0 破坏性变更

升级到 0.5.0 前请阅读以下变更：

- **仅支持 ESM**：移除了 `require` 条件导出，`main` 指向 `dist/index.mjs`。使用 CommonJS（`require()`）引入本插件的项目需要迁移到 ESM，例如将 Vite 配置文件改名为 `vite.config.mts`。
- **Node.js 版本要求**：`^22.22.2 || ^24.15.0 || >=26.0.0`（随 `@babel/*` v8 升级）。
- **Babel 8**：宏解析底层升级到 `@babel/parser` v8。import attributes 仅支持 `with { ... }` 语法，已废弃的 `assert { ... }` 语法不再支持；带有该语法的页面文件将无法解析宏，退化为仅路径元数据。
- **生命周期钩子签名变更**：钩子不再接收整个 `PageContext`，改为仅接收对应阶段的输入或输出数据，部分钩子名称同步调整。对照表：

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

- **依赖清理**：`json5`、`yaml`、`detect-indent`、`detect-newline` 不再是运行时依赖（配置文件仍支持 `ts/mts/cts/js/cjs/mjs/json`，无行为变化）。

- **类型入口**：包名的 `types` 入口直指构建产物，仅配置 `"types": ["@uni-helper/vite-plugin-uni-pages"]` 不再带入 `definePage` 全局与 `virtual:uni-pages` 模块声明，请改用 `/client` 子路径（见上方「页面级配置 definePage」）。

- **类型修正（静默变更）**：以下 `@uni-helper/uni-pages-types` 的类型变更不会产生 TS 报错（接口带索引签名），但行为有差异：
  - `app-plus.softInputMode` / `softInputNavBar` 更名为官方拼写 `softinputMode` / `softinputNavBar`（App-Harmony 同步更名）。旧字段名不再有类型提示；`pages.json` 中已写的旧字段名请手动改为新拼写。
  - `GlobalStyle` 移除 `disableScroll` / `disableSwipeBack`。官方文档注明这两个配置只在页面级 `style` 中有效、在 `globalStyle` 中设置无效，现仅在 `PageStyle` 上保留；写在 `globalStyle` 里的这两个字段会被忽略。
- **不可用的 `pages.json` 直接报错**：已存在的 `pages.json` 若不是普通文件（例如目录）或缺少读写权限，插件现在抛出错误并停止生成；0.4.x 会把它删除并重建为占位内容，静默丢失手写内容。请先修复权限（如 `chmod u+w`）或自行删除该文件。

> 从 0.3.x 直接升级到 0.5.x 的用户请注意：`<route>` 自定义块与 `routeBlockLang` 选项已在 0.4.0 移除（0.3.24 起运行时会打印废弃提示），请改用 `definePage` 宏，迁移说明见 <https://uni-helper.js.org/vite-plugin-uni-pages/definePage>。

0.5.0 同时带来以下新能力：

- `definePage(null)` 按平台跳过页面注册（见上方「页面级配置 definePage」）
- 函数式 `definePage` 与 `define().ifdef()/.ifndef()` 条件 DSL（见上方「平台条件页面配置」）
- 插件生成的过期子包自动清理（见下方「多终端并发开发」）
- tabBar 顶层属性按平台分别记录，多平台取值互不覆盖（见下方「多终端并发开发」）
- 新增 `indent`、`eol`、`insertFinalNewline` 格式化选项

## 多终端并发开发

同一项目里同时运行到多个平台时（例如，两个终端分别运行 `pnpm run dev:mp-weixin` 和 `pnpm run dev:mp-alipay`），多个进程会读写同一个 `pages.json`。

本插件默认会：

- 通过文件锁串行化对 `pages.json` 的「读取已有内容 → 合并当前平台配置 → 写回」整个流程，避免并发写入互相覆盖；
- 保留其他平台已经写入的 `#ifdef` 条件编译块，只更新当前平台对应的条目；
- 对同一 `path`（或 tabBar 的 `pagePath`）的条目按内容去重：内容相同的条目会合并为一条，并把两个平台合在一起写（如 `H5 || MP-WEIXIN`），不会因为先后跑过多个平台而产生重复路由；
- tabBar 的 `list` 条目按配置顺序摆放：本次配置覆盖全部既有条目时（全量超集），整个列表按配置顺序输出——其他平台新增的条目会落在它声明的位置，而不是追加到末尾；没有覆盖全部条目时（其他平台有本平台不认识的条目），既有条目保持磁盘序，只把本次新增的条目插到声明位置，避免两个平台交替构建时来回翻转。两个平台的配置都覆盖全部条目但顺序不同时，共享文件跟随最后写入者：各平台重新生成后看到的是自己的配置顺序，但条目内容相同而合并成一条时没有按平台区分的副本，另一个正在运行的平台在下一次生成前可能读到对方顺序，并发开发时建议各平台保持一致的完整 tab 顺序。`pages` 数组不参与这个重排：首页条目由「首页提到最前」的规则单独管理，各平台声明的首页不同时，首页条目的相对顺序按首次出现保持稳定；
- tabBar 的顶层属性（`color`、`selectedColor`、`custom`、`position`、`midButton` 等）同样按平台分别记录：各平台取值不同时，每个平台的取值保存在自己的 `#ifdef` 块里（同一属性名会出现多个按平台互斥的副本，uni-app 条件编译后每个平台只剩一份）；取值相同时合并为一条不带条件的属性。只有声明了非空 `list` 的运行才会写属性，`list` 为空或未配置 tabBar 的运行不会覆盖其他平台已写入的属性。注意 `minify: true` 的输出无法携带注释，属性会变成最后写入的说了算，请对同一项目所有平台的构建保持一致的格式化设置；
- 手写的 `#ifndef` 块（插件自身只会写 `#ifdef`）表达不了「按平台列表」的规则，会原样保留、不参与合并，tabBar 属性上的 `#ifndef` 同样处理。页面与 tabBar 条目按「只包裹紧随其后的那一个条目」解释；tabBar 的外观属性支持一个条件块包住多个属性——块里每个属性会各自带上完整的 `#ifndef`/`#endif` 包裹重新输出（属性之间互相独立，各平台看到的显示/隐藏结果不变），`#ifdef` 多属性块同理按注释里列出的平台归属每个属性。扫描结果与某个 `#ifndef` 条目内容相同时，会并进该条目，避免当前平台出现重复路由。注意两个边界：当前平台恰好是被排除的平台时，内容相等的配置按 `#ifndef` 语义同样被隐藏；同一 tabBar 属性同时存在 `#ifndef` 副本与各平台不同取值的变体时，被多份副本覆盖的平台会出现重复键，按 JSON 规则后面的键覆盖前面的（当前平台自己的取值写在最后、优先生效）。

这样每个终端都能保留各自的平台配置。条件编译注释基于 `comment-json` 写入，最终 `pages.json` 同时包含所有平台的分支。

### 生成标记与过期子包清理

自 0.5.0 起，插件会在 `pages.json` 的 `pages` 与每个 `subPackages` 条目的头部写入生成标记注释（如 `// GENERATED BY UNI-PAGES, PLATFORM: H5 || MP-WEIXIN`），记录写入过该数组的平台全集。

平台全集**始终包含当前运行的平台**，即使本次运行没有向该数组贡献任何条目（例如所有页面都在当前平台通过 `definePage(null)` 跳过）。这样其他平台专属的条目会保持 `#ifdef` 包裹、不会不加包裹地输出：uni-app 条件编译下，没被包裹的条目所有平台都看得见，不加包裹会把它们漏进当前平台的构建产物。平台全集还会把上一次运行记在标记里的平台算进来，并且只增不减：某平台的条目被它自己的扫描重写后，它也不会从全集中消失，避免多终端交替写入时，残留的条目被误判成盖住全平台、不加包裹地输出。

基于该标记，插件会自动清理由它生成、但在当前平台扫描中已不存在的条目：

- **页面条目**：主包 `pages` 中带生成标记但本次扫描没找到的条目，会把当前平台从它的平台列表里去掉；其他平台的 `#ifdef` 条目保留。
- **子包条目**：带生成标记且本次扫描没找到的子包（所有页面都被 `definePage(null)` 跳过，或目录被删除），当前平台已经看不到它的任何页面，整个子包条目会从 `pages.json` 中删除。这里不会保留其他平台条目的空壳：当前平台的构建产物里没有该分包目录，app.json 里留空壳会指向一个不存在的 root。删除不会丢状态——每个平台每次运行都会从自己的扫描结果重写条目，其他平台下次写入时会把子包重新写回。
- **子包 `plugins`**：`subPackages` 配置里的 `plugins` 跟着配置走——配置里有就随子包写进 `pages.json`，配置里删掉后就从插件生成的子包（带生成标记）上自动清掉，不会一直留在产物里。手写子包（没有生成标记）的 `plugins` 不受影响。
- **用户手写内容**：没有生成标记的条目视为用户手写，插件永远不会修改或删除它们。如果你在 `pages.config.ts` 的 `subPackages` 里手动维护子包，或直接在 `pages.json` 里手写子包条目，它们不受清理影响。在 `pages.config.ts` 的子包里写 `pages` 时，`path` 按 `pages.json` 的惯例**相对 `root` 书写**（如 `root` 为 `pkg` 时写 `detail`）：同一个页面文件扫描到时，两条会按页合并成一条，你写的属性（如 `style`）覆盖扫描结果。

> 注意：这个约定依赖生成标记的存在。不要删除插件写入的 `// GENERATED BY UNI-PAGES, PLATFORM: ...` 注释行，否则对应条目会被视为用户手写，过期后不再被清理。

### 平台全集只增不减

平台全集只增不减：某平台写入过一次，它就会一直留在标记里（即使该平台的开发终端之后再也不运行）。多算的平台唯一的影响，是让各平台不相同的条目一直包着 `#ifdef`——多余但无害，不会漏东西。

如果确实彻底停用了某个平台、想让 `pages.json` 回到干净状态：**不要手动编辑标记行**（改错会导致条目被误判为用户手写，或不加包裹地漏出去），直接删除生成的 `pages.json`，下次运行会从零重新生成。

另外，「用户手写内容永不修改或删除」的保护范围仅指上述清理逻辑覆盖的场景（带生成标记的子包条目）。`pages` 数组中不带生成标记、也不在本次扫描结果里的手写页面条目，会在合并时因平台列表为空而被丢弃——这是历史行为；需要长期保留的手写页面建议放进 `pages.config.ts` 的 `pages` 数组，插件每次都会原样并入。

## 开发

环境搭建、常用命令、测试与项目结构见仓库根目录的 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 架构

插件围绕 `PageContext` 组织核心流程，流水线阶段顺序固定（加载用户配置 → 扫描页面 → 合并页面配置 → 写入 pages.json），各专项能力放在独立的模块里：

```
index.ts          Vite 插件入口 — configResolved / transform / configureServer / resolveId / load
context.ts        PageContext 编排核心 — 配置加载、扫描、合并、串行生成、监听编排、虚拟模块与 HMR
pipeline.ts       纯流水线入口 — createPages / generateAll，root 和 platform 从外部传入，测试直接走这里
config-loader.ts  配置加载 — unconfig 装载、本地依赖与恢复候选收集、监听路径归一化
directories.ts    目录发现 — glob 展开、subPackages root 映射与扫描目录投影
page-rules.ts     页面规则 — 基于 Vite root 编译排除模式，统一扫描与事件判定
page-sources.ts   扫描来源与页面归属 — 来源身份、代表选择、生成路由冲突与文件族校验
page-watch.ts     页面监听 — 当前词法来源、内容目标订阅与非递归恢复入口
page-watch-sources.ts 监听依赖发现 — 顶层与嵌套链接解析、悬空目标保留及循环剪枝
page-watch-filter.ts 监听过滤 — 将 Vite ignored 规则应用于词法来源路径
pages-json.ts     pages.json 读-改-写 — 多平台 #ifdef 合并、首页排前、
                  生成标记与过期子包清理、序列化格式化、文件锁与原子写入
platform-variants.ts 平台变体表 — 跨平台合并的共享规则，数组侧与对象侧两类适配器共用
tab-bar.ts        tabBar 外观属性的跨平台合并与渲染（对象侧适配器）
jsonc-scan.ts     从 pages.json 原始文本里捞回 comment-json 解析时丢掉的重复键
files.ts          文件工具 — 页面扫描、路径解析、文件锁（withFileLock）、pages.json 合法性检查
macro.ts          definePage 宏解析 — SFC 解析、单个 script 块失败不影响别的块、
                  对象 / 函数 / 异步函数三种形态求值
condition.ts      按平台写配置 — define().ifdef()/.ifndef()，扫描时就算成当前平台的普通对象
page.ts           页面实体 — 文件读取、宏求值、变更检测、跳过状态
options.ts        选项解析 — 默认值合并与扫描规则保留
declaration.ts    uni-pages.d.ts 生成，为导航 API 提供路径类型检查
config.ts         defineUniPages 辅助函数 + 类型重导出
constant.ts       常量 — 虚拟模块 ID、页面文件扩展名（vue / nvue / uvue）
logger.ts         分类 debug 日志
types.ts          公共类型定义（Options / UserOptions / ResolvedOptions）
```

### 模块依赖关系

```shell
index.ts
  ├─ context.ts（编排核心）
  │    ├─ config-loader.ts             配置装载与恢复监听
  │    ├─ options.ts ── directories.ts 选项解析与目录发现
  │    ├─ files.ts                     扫描与文件锁
  │    ├─ page.ts ── macro.ts ── condition.ts
  │    ├─ page-sources.ts              来源身份、代表选择与生成路由冲突
  │    ├─ page-watch.ts                页面内容订阅与恢复入口
  │    │    ├─ page-watch-sources.ts   词法来源到物理目标的依赖发现
  │    │    ├─ directories.ts / page-rules.ts 目录发现与词法范围
  │    │    └─ page-watch-filter.ts    Vite ignored 规则匹配
  │    ├─ pages-json.ts                读-改-写，内含文件锁
  │    ├─ platform-variants.ts         平台变体表（两者按类型互相引用）
  │    ├─ tab-bar.ts ── jsonc-scan.ts  tabBar 属性合并与原文重复键扫描
  │    └─ declaration.ts
  ├─ config-loader.ts                  插件工厂预检的路径归一化
  └─ files.ts                          pages.json 预检与路径解析
pipeline.ts ── context.ts              测试与外部调用的流水线入口
```

### 插件生命周期

插件通过 Vite 的生命周期钩子驱动，顺序如下：

1. **插件工厂调用**（同步）— 预检 `pages.json` 是否存在且合法（此时 `config.root` 未知，回退到 `VITE_ROOT_DIR` / `process.cwd()` 解析路径）
2. **`configResolved`**（异步）— 初始化或复用 `PageContext`，检测是否与 `vite-plugin-uni-platform` 协同，完成首次 pages.json 生成；`build --watch` 模式下另建 watcher，接收配置文件事件与页面目录结构通知，同时启动自有页面监听器
3. **`configureServer`**（dev）— 从 Vite 的 `server.watcher` 接收配置文件及其依赖的事件和页面目录结构通知，并按 Vite 的监听开关、忽略规则和轮询设置启动自有页面监听器；产物更新后失效虚拟模块并通知浏览器 full-reload
4. **`transform`** — 从 vue / nvue / uvue 文件中移除 `definePage` 宏调用，避免运行时报错
5. **`resolveId` / `load`** — 提供 `virtual:uni-pages` 虚拟模块，暴露所有页面元数据
6. **`closeWatcher` / `closeBundle`** — 按运行模式释放本插件持有的监听资源，并解绑共享 watcher 的回调；Vite 负责关闭共享 watcher

### 关键设计决策

- **串行生成**：公开方法 `PageContext.updatePagesJSON(filepath?)` 与内部页面事件批次共用串行生成队列，配置加载、扫描、合并和写入的阶段顺序集中维护。传入文件路径时尝试增量读取，省略时执行完整刷新。
- **read-modify-write + 生成标记**：平台状态保存在 `pages.json` 自身（`// GENERATED BY UNI-PAGES, PLATFORM: ...` 标记），无需外部缓存文件；无标记的条目视为用户手写，插件永不修改。过期生成物基于该标记自动清理。
- **文件锁 + 原子写入**：整个「读 → 合并 → 写」在同一个 `withFileLock` 内执行，写入走 tmp + rename，多终端并发（如同时跑 mp-weixin 和 mp-alipay）不会互相覆盖或读到写了一半的内容。
- **内容不变就不写**：写入前先和磁盘上的内容比一遍，没变化就跳过，避免触发下游不必要的重编译。
- **监听职责**：配置事件来自 Vite 的共享 watcher 或 `build --watch` 中创建的 watcher，触发完整生成；其中有效页面目录的结构通知也会触发补扫。`PageSourceWatch` 从声明目录发现顶层和嵌套链接，统一处理物理目标的页面文件事件，并管理非递归恢复入口。发现过程不依赖已收录页面，因此空目录和悬空链接也能恢复；原生目录通知补充 chokidar 不投递 `add` 的悬空链接创建。按当前全部来源汇总物理订阅，来源或目录身份变化时重新建立订阅，避免复用旧目标句柄；关闭后不再发现或订阅。
- **增量页面更新**：普通内容变更只重读相关物理文件的缓存候选，元数据未变时跳过配置加载与产物生成。页面事件按待处理批次合并；批次内含新增、删除、目标切换或恢复等结构变化时执行完整刷新，生成期间到达的事件留给下一轮。
- **宏解析失败隔离**：每个 `<script>` 块独立解析，单块语法错误（如 Babel 8 已移除的 `assert` import attributes）只影响该块，不会阻断其它块的宏移除。
- **无导入时副作用**：所有文件系统操作都在插件生命周期内执行，而非模块导入时，模块可独立测试。
- **可从外部传入的入口**：`pipeline.ts` 的 `root` / `platform` 从外部传入，测试不绑定进程环境变量，平台相关快照结果确定。

## 感谢

- [hannoeru/vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages)
- [uni-ku/pages-json](https://github.com/uni-ku/pages-json)

## 关联项目

- [@uni-helper/vite-plugin-uni-pages](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/core) - 使用 TypeScript 编写 uni-app 的 pages.json，支持约定式路由
- [@uni-helper/pages-json-schema](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/schema) - 为 uni-app 的 pages.json 提供 schema
- [@uni-helper/uni-pages-types](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/types) - 为 uni-app 的 pages.json 提供 TypeScript 类型
- [uni-helper/vite-plugin-uni-manifest](https://github.com/uni-helper/vite-plugin-uni-manifest) - 使用 TypeScript 来编写 uni-app 的 manifest.json
- [uni-helper/vite-plugin-uni-platform](https://github.com/uni-helper/vite-plugin-uni-platform) - 基于文件名 (*.<h5|mp-weixin|app>.*) 的按平台编译插件
- [uni-helper/vite-plugin-uni-platform-modifier](https://github.com/uni-helper/vite-plugin-uni-platform-modifier) - 为属性、指令提供平台修饰符并按需编译
- [uni-helper/vite-plugin-uni-layouts](https://github.com/uni-helper/vite-plugin-uni-layouts) - 为 Vite 下的 uni-app 提供类 nuxt 的 layouts 系统
- [uni-ku/root](https://github.com/uni-ku/root) - 解决 uni-app 无法使用根部组件问题
