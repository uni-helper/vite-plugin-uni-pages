# @uni-helper/vite-plugin-uni-pages

<a href="https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages" alt="NPM version"></a></p>

使用 TypeScript 编写 `uni-app` 的 `pages.json`。支持约定式路由。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/vite-plugin-uni-pages"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a> <a href="https://zread.ai/uni-helper/vite-plugin-uni-pages" target="_blank"><img src="https://img.shields.io/badge/Ask_Zread-_.svg?style=flat&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a>

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

```ts
// vite.config.ts
import Uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

// It is recommended to put it in front of Uni
export default defineConfig({
  plugins: [UniPages(), Uni()],
})
```

创建 `pages.config.(ts|mts|cts|js|cjs|mjs|json)`，然后用 TypeScript 编写你的 `pages.json`。你可以在创建的文件里使用 `#ifdef H5` 等条件编译语句。

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'

export default defineUniPages({
  // 你可以手动指定 pages，这种做法具有最高优先级，插件会使用你指定的 pages 生成 pages.json。
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

你也可以导入 [虚拟模块](https://v5.vite.dev/guide/api-plugin.html#virtual-modules-convention) 来访问所有页面的元数据。

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from 'virtual:uni-pages'

console.log(pages)
```

在 [这里](../../playground/pages.config.ts)，你可以找到 `uni-app` 默认的 Vite-TS 模版的 `pages.json` 是如何用 TypeScript 编写的。

## 插件配置

```ts
interface UserOptions {
  /**
   * 生成页面路径的 TypeScript 类型声明
   * 为 true 时在项目根目录生成 uni-pages.d.ts
   * 为 string 时作为自定义输出路径（相对于项目根目录）
   * @default true
   */
  dts?: boolean | string

  /**
   * 页面配置文件的加载源
   * 基于 unconfig，支持多配置源合并
   * 默认为 pages.config，支持 ts/mts/cts/js/cjs/mjs/json 等后缀
   * @default 'pages.config'
   */
  configSource?: ConfigSource

  /**
   * 默认应用入口页面（首页）
   * 当没有页面通过 definePage({ type: 'home' }) 标记为首页时使用
   * 支持多个路径样式以兼容不同的目录结构
   * @default 'pages/index' 或 'pages/index/index'
   */
  homePage?: string

  /**
   * 是否自动扫描目录并合并页面配置到 pages.json
   * 关闭后仅加载用户配置文件，不扫描文件系统
   * @default true
   */
  mergePages?: boolean

  /**
   * 主包页面的搜索目录
   * 支持 glob 模式，如 'src/{pages,views}'
   * 最终结果由 tinyglobby 解析为匹配的目录列表
   * @default 'src/pages'
   */
  dir?: string

  /**
   * 分包页面目录的根目录列表
   * 
   * 用于 uni-app 的分包加载功能
   * 
   * 支持字符串格式（目录路径）或对象格式（自定义 pages.json 中的 root）
   * 
   * 更多上下文参考 <https://github.com/uni-helper/vite-plugin-uni-pages/issues/271>
   * @default []
   */
  subPackages?: (string | { dir: string; root: string })[]

  /**
   * pages.json 所在目录
   * 相对于项目根目录，也是计算页面相对路径的基准
   * @default 'src'
   */
  outDir?: string

  /**
   * 排除的文件/目录模式
   * 基于 tinyglobby 的 ignore 选项
   * @default ['node_modules', '.git', '**/__*__/**']
   */
  exclude?: string[]

  /**
   * 是否压缩生成的 pages.json
   * @default false
   */
  minify?: boolean

  /**
   * 启用调试日志
   * 为 true 时启用所有分类；为字符串时仅启用特定分类
   * 可选分类：hmr | options | pages | subPages | error | cache | declaration | definePage
   * 也可通过环境变量 DEBUG=vite-plugin-uni-pages:* 控制
   * @default false
   */
  debug?: boolean | debugType

  // 生命周期钩子，在每个阶段完成后触发，接收 PageContext 实例
  onBeforeLoadUserConfig?: (ctx: PageContext) => void
  onAfterLoadUserConfig?: (ctx: PageContext) => void
  onBeforeScanPages?: (ctx: PageContext) => void
  onAfterScanPages?: (ctx: PageContext) => void
  onBeforeMergePageMetaData?: (ctx: PageContext) => void
  onAfterMergePageMetaData?: (ctx: PageContext) => void
  onBeforeWriteFile?: (ctx: PageContext) => void
  onAfterWriteFile?: (ctx: PageContext) => void
}
```

### 流程说明

插件内部按以下顺序执行生命周期，每个阶段对应一个生命周期钩子：

```
加载用户配置 → 扫描页面文件 → 合并页面元数据 → 生成并写入 pages.json
```

- **加载用户配置**：通过 `unconfig` 加载 `pages.config.ts` 等配置文件，获取手动指定的页面元数据（`pages`、`subPackages`、`globalStyle` 等）
- **扫描页面文件**（仅在 `mergePages: true` 时）：根据 `dir` 和 `subPackages` 扫描文件系统，为每个页面文件创建 `Page` 实例
- **合并页面元数据**：将扫描到的页面与用户配置中的页面元数据合并
- **生成并写入**：序列化为 `pages.json`，写入到 `outDir` 目录，并生成 TypeScript 类型声明

### 配置示例

```ts
// vite.config.ts
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
      onAfterScanPages(ctx) {
        console.log(`扫描到 ${ctx.pages.size} 个主包页面`)
      },
    }),
  ],
})
```

### 完整类型定义

请查看 [types.ts](./src/types.ts) 获取完整定义。

## FAQ

### 这个插件写入配置晚于 uni-app 读取配置

请使用 [@uni-helper/unh](https://uni-helper.cn/unh/auto-generate)，或自行编写脚本处理。

### 支持 JSX/TSX 吗？

不支持，只支持 vue/nvue/uvue 文件

### 文件名有限制吗？

文件名内不能带有额外的 `.` 分隔符，如 `index.v1.vue` 不合法。这是小程序的限制，并非本插件的限制。

### 支持 monorepo 吗？

在 monorepo 项目中，如果页面分布在多个 package 中，可以使用 `subPackages` 配置的对象格式来自定义生成的 `root` 路径。

```ts
// vite.config.ts
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

## 感谢

- [hannoeru/vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages)
- [uni-ku/pages-json](https://github.com/uni-ku/pages-json)
