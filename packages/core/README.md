# @uni-helper/vite-plugin-uni-pages

File system-based routing for uni-app applications using Vite.

<a href="https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages" alt="NPM version"></a></p>

English | [简体中文](./README.Zh-CN.md)

## Installation

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## Usage

```ts
import Uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
// vite.config.ts
import { defineConfig } from 'vite'

// It is recommended to put it in front of Uni
export default defineConfig({
  plugins: [UniPages(), Uni()],
})
```

Define global properties in `pages.config.(ts|mts|cts|js|cjs|mjs|json)`, You can use like `#ifdef H5` in the file.

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'

export default defineUniPages({
  // You can also define pages fields, which have the highest priority.priority.
  pages: [],
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '@uni-helper',
  },
})
```

Now all pages will be found automatically!

### SFC custom block for Route Data

Add route meta to the route by adding a `<route>` block to the SFC. This will be
directly added to the route after it is generated, and will override it.

You can specify a parser to use using `<route lang="yaml">`, or set a default
parser using `routeBlockLang` option.

- **Supported parser:** JSON, JSON5, YAML
- **Default:** JSON5

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

Import the virtual module to access the metadata of all pages

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from 'virtual:uni-pages'

console.log(pages)
```

## Configuration

```ts
export interface Options {
  /**
   * Whether to scan and merge pages in pages.json
   * @default true
   */
  mergePages: boolean

  /**
   * Paths to the directory to search for page components.
   * @default 'src/pages'
   */
  dir: string

  /**
   * pages.json dir
   * @default "src"
   */
  outDir: string

  /**
   * exclude page
   * @default []
   */
  exclude: string[]

  /**
   * Set the default route block parser, or use `<route lang="xxx">` in SFC route block
   * @default 'json5'
   */
  routeBlockLang: 'json5' | 'jsonc' | 'json' | 'yaml' | 'yml'

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

## Acknowledgement

- [vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages.git)
