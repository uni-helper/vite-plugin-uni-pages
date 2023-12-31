# @uni-helper/vite-plugin-uni-pages

在 Vite 驱动的 uni-app 上使用基于文件的路由系统。

<a href="https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages" alt="NPM version"></a></p>

## Packages

- [vite-plugin-uni-pages](./packages/core/)

  核心，提供基于文件的路由系统
- [volar-service-uni-pages](./packages/volar/)

  为 `<route>` 块 提供 IntelliSense
- [pages-json-schema](./packages/schema/)

  为 uni-app 的 `pages.json` 提供 schema

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import Uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

// It is recommended to put it in front of Uni
export default defineConfig({
  plugins: [UniPages(), Uni()],
})
```

在 `pages.config.(ts|mts|cts|js|cjs|mjs|json)` 定义全局属性，你可以在文件中使用 `#ifdef H5` 类似语法。

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'

export default defineUniPages({
  // 你也可以定义 pages 字段，它具有最高的优先级。
  pages: [],
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '@uni-helper',
  },
})
```

现在所有的 page 都会被自动发现！

### SFC 自定义块用于路由数据

通过添加一个 `<route>` 块到 SFC 中来添加路由元数据。这将会在路由生成后直接添加到路由中，并且会覆盖。

你可以使用 `<route lang="yaml">` 来指定一个解析器，或者使用 `routeBlockLang` 选项来设置一个默认的解析器。

- **解析器支持：** JSON, JSON5, YAML
- **默认：** JSON5

```html
<!-- index.vue -->
<!-- 使用 type="home" 属性设置首页 -->
<route type="home" lang="json">
{
  "style": { "navigationBarTitleText": "@uni-helper" }
}
</route>

<!-- other.vue -->
<route lang="yaml">
style:
  navigationBarTitleText: "@uni-helper"
</route>
```

导入虚拟模块即可访问所有页面的元数据

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from 'virtual:uni-pages'

console.log(pages)
```

## 配置

```ts
export interface Options {
  /**
   * 为页面路径生成 TypeScript 声明
   *
   * 接受布尔值或与相对项目根目录的路径
   *
   * 默认为 uni-pages.d.ts
   *
   * @default true
   */
  dts?: boolean | string

  /**
   * 配置文件
   * @default 'pages.config.(ts|mts|cts|js|cjs|mjs|json)',
   */
  configSource: ConfigSource

  /**
   * 设置默认路由入口
   * @default 'pages/index' || 'pages/index/index'
   */
  homePage: string

  /**
   * 是否扫描并合并 pages.json 中 pages 字段
   * @default true
   */
  mergePages: boolean

  /**
   * 扫描的目录
   * @default 'src/pages'
   */
  dir: string

  /**
   * subPackages 扫描的目录，例如：src/pages-sub
   */
  subPackages: string[]

  /**
   * 输出 pages.json 目录
   * @default "src"
   */
  outDir: string

  /**
   * 排除的页面，相对于 dir 和 subPackages
   * @default []
   * @example ['**/components/**/*.*']
   */
  exclude: string[]

  /**
   * 自定义块语言
   * @default 'json5'
   */
  routeBlockLang: 'json5' | 'json' | 'yaml' | 'yml'

  onBeforeLoadUserConfig: (ctx: PageContext) => void
  onAfterLoadUserConfig: (ctx: PageContext) => void
  onBeforeScanPages: (ctx: PageContext) => void
  onAfterScanPages: (ctx: PageContext) => void
  onBeforeMergePageMetaData: (ctx: PageContext) => void
  onAfterMergePageMetaData: (ctx: PageContext) => void
  onBeforeWriteFile: (ctx: PageContext) => void
  onAfterWriteFile: (ctx: PageContext) => void
}
```

## 感谢

- [vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages.git)
