# @uni-helper/vite-plugin-uni-pages

<p style="text-align: center">
  <a href="https://github.com/uni-helper/vite-plugin-uni-pages/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Stars"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/dm/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Downloads"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="NPM Version"></a>
</p>
<p style="text-align: center">
  <a href="https://github.com/kejunmao"><img src="https://img.shields.io/badge/Author-KeJun-blue?style=for-the-badge" alt="Author"></a>
  <a href="https://github.com/ModyQyW"><img src="https://img.shields.io/badge/Maintainer-ModyQyW-blue?style=for-the-badge" alt="Author"></a>
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
   * 支持字符串格式（目录路径）或对象格式（自定义 pages.json 中的 root）
   * 更多上下文参考 <https://github.com/uni-helper/vite-plugin-uni-pages/issues/271>
   * @default []
   * @since 0.1.8
   */
  subPackages?: (string | { dir: string, root: string })[]

  /**
   * pages.json 所在目录
   * 相对于项目根目录，也是计算页面相对路径的基准
   * @default 'src'
   * @since 0.0.1
   */
  outDir?: string

  /**
   * 排除的文件/目录模式
   * 基于 tinyglobby 的 ignore 选项
   * @default ['node_modules', '.git', '**\/__*__/**']
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
      exclude: ['node_modules', '.git', '**/__*__/**', '**/components/**'],
      minify: true,
      debug: true, // 或 debug: 'pages'
      onAfterScanPages(pages) {
        console.log(`扫描到 ${pages.size} 个主包页面`)
      },
    }),
  ],
})
```

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

0.5.0 同时带来以下新能力：

- `definePage(null)` 按平台跳过页面注册（见上方「页面级配置 definePage」）
- 函数式 `definePage` 与 `define().ifdef()/.ifndef()` 条件 DSL（见上方「平台条件页面配置」）
- 插件生成的过期子包自动收敛（见下方「多终端并发开发」）
- 新增 `indent`、`eol`、`insertFinalNewline` 格式化选项

## 多终端并发开发

同一项目里同时运行到多个平台时（例如，两个终端分别运行 `pnpm run dev:mp-weixin` 和 `pnpm run dev:mp-alipay`），多个进程会读写同一个 `pages.json`。

本插件默认会：

- 通过文件锁串行化对 `pages.json` 的「读取已有内容 → 合并当前平台配置 → 写回」整个流程，避免并发写入互相覆盖；
- 保留其他平台已经写入的条件编译块（`#ifdef H5` / `#ifndef MP-WEIXIN` 等），只更新当前平台对应的条目；
- 对同一 `path`（或 tabBar 的 `pagePath`）的条目按内容去重：内容相同的条目会合并为一条并叠加平台标识（如 `H5 || MP-WEIXIN`），不会因为先后跑过多个平台而产生重复路由。

这样每个终端都能保留各自的平台配置。条件编译注释基于 `comment-json` 写入，最终 `pages.json` 同时包含所有平台的分支。

### 生成标记与过期子包收敛

自 0.5.0 起，插件会在 `pages.json` 的 `pages` 与每个 `subPackages` 条目的头部写入生成标记注释（如 `// GENERATED BY UNI-PAGES, PLATFORM: H5 || MP-WEIXIN`），用于记录写入过该数组的平台全集。

平台全集**始终包含当前运行的平台**，即使本次运行没有向该数组贡献任何条目（例如所有页面都在当前平台通过 `definePage(null)` 跳过）。这样其他平台专属的条目会保持 `#ifdef` 包裹而不会裸发射：uni-app 条件编译下，未被包裹的条目对所有平台可见，裸发射会把它们泄漏进当前平台的构建产物。平台全集还会吸收上一次运行记录在标记里的平台，成员资格跨运行单调：某平台的条目被它自己的扫描重写后，它的成员资格也不会从全集里消失，避免多终端交替写入时残留条目被误判覆盖全平台而裸发射。

基于该标记，插件会自动收敛由它生成、但在当前平台扫描中已不存在的条目：

- **页面条目**：主包 `pages` 中带生成标记但本次扫描未命中的条目，会被剥离当前平台的成员资格；其他平台的 `#ifdef` 条目保留。
- **子包条目**：带生成标记且本次扫描未命中的子包（所有页面都被 `definePage(null)` 跳过，或目录被删除），当前平台已没有任何可见页面，整个子包条目会从 `pages.json` 中删除。这里不会保留其他平台的 `#ifdef` 条目壳：当前平台的构建产物里不存在该分包目录，app.json 里留下空壳会指向一个不存在的 root。删除不会丢失状态——每个平台每次运行都会从自己的扫描结果重写条目，其他平台下次写入时会把子包重新写回。
- **用户手写内容**：没有生成标记的条目视为用户手写，插件永远不会修改或删除它们。如果你在 `pages.config.ts` 的 `subPackages` 里手动维护子包，或直接在 `pages.json` 里手写子包条目，它们不受收敛影响。

> 注意：这个契约依赖生成标记的存在。不要删除插件写入的 `// GENERATED BY UNI-PAGES, PLATFORM: ...` 注释行，否则对应条目会被视为用户手写，过期后不再被清理。

### 平台全集只增不减

平台全集是单调的：某平台写入过一次，它的成员资格就会一直留在标记里（即使该平台的开发终端之后再也不运行）。残留成员的唯一影响是让各平台的差异条目持续保持 `#ifdef` 包裹——多余但无害，永远不会泄漏。

如果确实彻底停用了某个平台、想让 `pages.json` 回到干净状态：**不要手动编辑标记行**（改错会导致条目被误判为用户手写或裸泄漏），直接删除生成的 `pages.json`，下次运行会从零重新生成。

另外，「用户手写内容永不修改或删除」的保护范围仅指上述收敛逻辑覆盖的场景（带生成标记的子包条目）。`pages` 数组中不带生成标记、也不在本次扫描结果里的手写页面条目，会在合并时因平台列表为空而被丢弃——这是历史行为；需要长期保留的手写页面建议放进 `pages.config.ts` 的 `pages` 数组，插件每次都会原样并入。

## 开发

环境搭建、常用命令、测试与项目结构见仓库根目录的 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 架构

插件围绕 `PageContext` 编排核心构建，流水线阶段顺序固定（加载用户配置 → 扫描页面 → 合并元数据 → 写入 pages.json），各专项能力封装在独立的深模块中：

```
index.ts          Vite 插件入口 — configResolved / transform / configureServer / resolveId / load
context.ts        PageContext 编排核心 — 配置加载、扫描、合并、监听、虚拟模块与 HMR
pipeline.ts       纯流水线 seam — createPages / generateAll，root 和 platform 可注入，测试直接走这里
pages-json.ts     pages.json read-modify-write 深模块 — 多平台 #ifdef 合并、首页重排、
                  生成标记与过期子包收敛、序列化格式化、文件锁与原子写入
files.ts          文件工具 — 页面扫描、路径解析、文件锁（withFileLock）、pages.json 合法性检查
macro.ts          definePage 宏解析深模块 — SFC 解析、逐 script 块失败隔离、
                  对象 / 函数 / 异步函数三种形态求值
condition.ts      平台条件 DSL — define().ifdef()/.ifndef()，扫描阶段即按当前平台解析为普通对象
page.ts           页面实体 — 文件读取、宏求值、变更检测、跳过状态
options.ts        选项解析 — 默认值合并、glob 目录解析、subPackages root 映射
declaration.ts    uni-pages.d.ts 生成，为导航 API 提供路径类型检查
config.ts         defineUniPages 辅助函数 + 类型重导出
constant.ts       常量 — 虚拟模块 ID、页面文件扩展名（vue / nvue / uvue）
logger.ts         分类 debug 日志
types.ts          公共类型定义（Options / UserOptions / ResolvedOptions）
```

### 模块依赖关系

```shell
index.ts
  └─ context.ts（编排核心）
       ├─ options.ts                  选项解析
       ├─ files.ts                    扫描与文件锁
       ├─ page.ts ── macro.ts ── condition.ts
       ├─ pages-json.ts               read-modify-write（内含文件锁）
       └─ declaration.ts
pipeline.ts ── context.ts             测试与外部调用的流水线 seam
```

### 插件生命周期

插件通过 Vite 的生命周期钩子驱动，顺序如下：

1. **插件工厂调用**（同步）— 预检 `pages.json` 是否存在且合法（此时 `config.root` 未知，回退到 `VITE_ROOT_DIR` / `process.cwd()` 解析路径）
2. **`configResolved`**（异步）— 创建 `PageContext`，检测是否与 `vite-plugin-uni-platform` 协同，执行首次 `updatePagesJSON()` 生成 pages.json；`build --watch` 模式下另建 chokidar 监听页面目录
3. **`configureServer`**（dev）— 复用 Vite 的 `server.watcher`，把配置文件源（`pages.config.ts` 等）加入监听；变更时重跑完整流水线，失效虚拟模块并通知浏览器 full-reload
4. **`transform`** — 从 vue / nvue / uvue 文件中移除 `definePage` 宏调用，避免运行时报错
5. **`resolveId` / `load`** — 提供 `virtual:uni-pages` 虚拟模块，暴露所有页面元数据

### 关键设计决策

- **编排深模块**：`PageContext.updatePagesJSON()` 是唯一的完整流水线入口，阶段顺序封装其内，调用方（Vite 钩子、watcher 回调、测试）无需知道内部阶段。
- **read-modify-write + 生成标记**：平台状态持久化在 `pages.json` 自身（`// GENERATED BY UNI-PAGES, PLATFORM: ...` 标记），无需外部缓存文件；无标记的条目视为用户手写，插件永不修改。过期生成物基于该标记自动收敛。
- **文件锁 + 原子写入**：整个「读 → 合并 → 写」在同一个 `withFileLock` 内执行，写入走 tmp + rename，多终端并发（如同时跑 mp-weixin 和 mp-alipay）不会互相覆盖或读到半写入状态。
- **幂等写入**：写入前与上一次内容对比，未变化则跳过，避免触发下游不必要的重编译。
- **统一监听**：配置文件与页面文件共用同一个 chokidar（dev 下直接复用 Vite 的 watcher，不额外创建）；配置变更不做增量，直接重跑完整流水线，配合幂等写入避免冗余落盘。
- **增量页面更新**：页面文件变更时先经 `hasChanged()` 检测元数据是否真的变化，无变化则跳过整轮流水线。
- **宏解析失败隔离**：每个 `<script>` 块独立解析，单块语法错误（如 Babel 8 已移除的 `assert` import attributes）只影响该块，不会阻断其它块的宏移除。
- **无导入时副作用**：所有文件系统操作都在插件生命周期内执行，而非模块导入时，模块可独立测试。
- **seam 注入**：`pipeline.ts` 的 `root` / `platform` 可注入，测试不绑定进程环境变量，平台相关快照结果确定。

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
