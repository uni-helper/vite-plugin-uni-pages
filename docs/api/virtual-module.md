# 虚拟模块

插件提供 `virtual:uni-pages`，业务代码可以直接读取当前生成的路由数据。

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages, subPackages } from 'virtual:uni-pages'

console.log(pages)
console.log(subPackages)
```

## 导出

| 导出 | 类型 | 内容 |
| --- | --- | --- |
| `pages` | `InternalPages` | 主包页面配置数组，和 `pages.json` 的 `pages` 一致 |
| `subPackages` | `SubPackages` | 分包配置数组 |

`pages` 包含插件内部的 `type` 标记（`'home'` 或 `'page'`）。其他字段就是普通的 `pages.json` 页面配置。

数据是当前平台合并后的结果。用 `definePage(null)` 跳过的页面不会出现。

## 类型

`/client` 子路径同时声明了 `definePage` 全局宏和 `virtual:uni-pages` 模块。运行时类型来自插件内部的 `InternalPages`，打包后的 `.d.ts` 也会包含这个类型。

如果只需要 `pages.json` 的结构类型，可以直接使用：

```ts
import type { PageItem, SubPackages } from '@uni-helper/uni-pages-types'
```

## 生成的声明文件

`dts` 开启时，插件会生成 `uni-pages.d.ts`，其中包含：

- `navigateTo`、`redirectTo` 的 URL 联合类型，自动排除 tabBar 页面
- `switchTab` 只接受 tabBar 页面的路径
- `reLaunch` 接受两类路径
- `virtual:uni-pages` 模块的 `LocationUrl` 导出

tabBar 页面来自 `pages.config.ts` 和 `definePage({ tabBar })` 的合并结果，只在一个地方声明的 tab 页也会被正确排除。

生成的声明文件带 `// @ts-nocheck`，不会被项目的严格检查影响。

## 稳定性

虚拟模块的导出结构不保证稳定，可能在小版本中调整。它适合读取展示用的元数据，不建议作为长期公共 API 使用。

页面或配置变化后，插件会更新虚拟模块并触发浏览器整页刷新。业务代码不需要手工订阅。
