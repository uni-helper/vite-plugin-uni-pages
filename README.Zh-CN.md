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

在 `pages.config.(ts|mts|cts|js|cjs|mjs|json)` 定义全局属性

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

现在所有的 page 都会被自动发现！

### SFC 自定义块用于路由数据


Add route meta to the route by adding a `<route>` block to the SFC. This will be
directly added to the route after it is generated, and will override it.

通过添加一个`<route>`块到 SFC 中来添加路由元数据。这将会在路由生成后直接添加到路由中，并且会覆盖。

你可以使用 `<route lang="yaml">` 来指定一个解析器，或者使用 `routeBlockLang` 选项来设置一个默认的解析器。

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

导入虚拟模块即可访问所有页面的元数据

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from 'virtual:uni-pages'
console.log(pages)
```

## 配置

查看 [types.ts](./src/types.ts)

## 钩子

你不能在 `pages.json` 中使用类似 `#ifdef H5`, 但是使用 [hooks](./src/types.ts) 可以改变 pagesMeta.

```ts
// vite.config.ts
UniPages({
  onBeforeWriteFile(ctx) {
    ctx.pagesMeta = ctx.pagesMeta?.filter(v => !v.path.includes('test'))
  },
})
// ...
```

这是条件编译的一个很好的替代方案, 你还可以在 `vite.config.ts` 中使用 `exclude` 来排除部分页面。

怎么做? 打印 `process.env` 然后找到 `UNI_*`, 我相信你已经会了

## 感谢

- [vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages.git)
