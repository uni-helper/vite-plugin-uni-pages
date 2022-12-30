# @uni-helper/vite-plugin-uni-pages

File system-based routing for uni-app applications using Vite

English | [简体中文](./README.Zh-CN.md)

## Installation

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## Usage

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

Define global properties in `pages.config.(ts|mts|cts|js|cjs|mjs|json)`

```ts
// pages.config.ts
import { definePages } from '@uni-helper/vite-plugin-uni-pages'

export default definePages({
  // You can also specify pages, and the content will be merged
  pages: [],
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '@uni-helper',
    navigationBarBackgroundColor: '#F8F8F8',
    backgroundColor: '#F8F8F8',
  },
})
```

Now all pages will be found automatically!

You can use route-block in the page to specify metadata

```vue
<!-- index.vue -->
<!-- use type to set index -->
<route lang="json" type="home">
{
  "style": { "navigationBarTitleText": "@uni-helper" }
}
</route>

<!-- other.vue -->
<route lang="json">
{
  "style": { "navigationBarTitleText": "@uni-helper" },
  "any-meta-data": "hello"
}
</route>
```

Import the virtual module to access the metadata of all pages

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from 'virtual:uni-pages'
console.log(pages)
```

## Configuration

see [types.ts](./src/types.ts)

## Hooks

You can not use like `#ifdef H5` in `pages.json`, but use [hooks](./src/types.ts) to change pagesMeta.

```ts
// vite.config.ts
UniPages({
  onBeforeWriteFile(ctx) {
    ctx.pagesMeta = ctx.pagesMeta?.filter(v => !v.path.includes('test'))
  },
})
// ...
```

This is a good alternative to conditional compilation, you can also use `exclude` in `vite.config.ts`

How? console the `process.env` and found `UNI_*`, you can do this!

## TODO

- [ ] only update the changed page
- [x] [vite-plugin-uni-middleware](https://github.com/uni-helper/vite-plugin-uni-middleware)
- [x] pages [type](./src/config/types.ts)

## Acknowledgement

- [vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages.git)