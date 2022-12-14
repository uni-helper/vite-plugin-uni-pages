# @uni-helper/vite-plugin-uni-pages

在 Vite 驱动的 uni-app 上使用基于文件的路由系统

[English](./README.md) | 简体中文

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
<!-- use type to set index -->
<route type="home">
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
   * 输出 pages.json 目录
   * @default "src"
   */
  outDir: string

  /**
   * 排除的页面
   * @default []
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
