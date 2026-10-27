# @uni-helper/pages-json-schema

<p style="text-align: center">
  <a href="https://github.com/uni-helper/vite-plugin-uni-pages/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Stars"></a>
  <a href="https://npmx.dev/package/@uni-helper/pages-json-schema"><img src="https://img.shields.io/npm/dm/@uni-helper/pages-json-schema?colorA=005947&colorB=eee&style=for-the-badge" alt="Downloads"></a>
  <a href="https://npmx.dev/package/@uni-helper/pages-json-schema"><img src="https://img.shields.io/npm/v/@uni-helper/pages-json-schema?colorA=005947&colorB=eee&style=for-the-badge" alt="NPM Version"></a>
</p>
<p style="text-align: center">
  <a href="https://github.com/kejunmao"><img src="https://img.shields.io/badge/Author-KeJun-blue?style=for-the-badge" alt="Author"></a>
  <a href="https://github.com/ModyQyW"><img src="https://img.shields.io/badge/Maintainer-ModyQyW-blue?style=for-the-badge" alt="Maintainer"></a>
</p>

为 uni-app 的 `pages.json` 提供 schema。

完整文档见 [uni-helper.js.org](https://uni-helper.js.org/vite-plugin-uni-pages)，另有 [Netlify](https://vite-plugin-uni-pages.netlify.app) 和 [Cloudflare Pages](https://vite-plugin-uni-pages.pages.dev) 镜像。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/vite-plugin-uni-pages"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

> **请考虑持续[赞助](https://github.com/ModyQyW/sponsors)以维持该项目的持续健康发展，非常感谢！🙏**

## 安装

```bash
pnpm add @uni-helper/pages-json-schema
```

## 用法

```js
import PagesSchema from '@uni-helper/pages-json-schema'

console.log(PagesSchema)

// {
//   "$ref": "#/definitions/PagesConfig",
//   "$schema": "http://json-schema.org/draft-07/schema#",
//   "definitions": {...}
// }
```

## 关联项目

- [skiyee/oiyo](https://oiyo.js.org) - uni-app 增强型工程框架
- [@uni-helper/vite-plugin-uni-pages](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/core) - 使用 TypeScript 编写 uni-app 的 pages.json，支持约定式路由
- [@uni-helper/pages-json-schema](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/schema) - 为 uni-app 的 pages.json 提供 schema
- [@uni-helper/uni-pages-types](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/types) - 为 uni-app 的 pages.json 提供 TypeScript 类型
- [uni-helper/vite-plugin-uni-manifest](https://github.com/uni-helper/vite-plugin-uni-manifest) - 使用 TypeScript 来编写 uni-app 的 manifest.json
- [uni-helper/vite-plugin-uni-platform](https://github.com/uni-helper/vite-plugin-uni-platform) - 基于文件名 (*.<h5|mp-weixin|app>.*) 的按平台编译插件
- [uni-helper/vite-plugin-uni-platform-modifier](https://github.com/uni-helper/vite-plugin-uni-platform-modifier) - 为属性、指令提供平台修饰符并按需编译
- [uni-helper/vite-plugin-uni-layouts](https://github.com/uni-helper/vite-plugin-uni-layouts) - 为 Vite 下的 uni-app 提供类 nuxt 的 layouts 系统
- [uni-ku/root](https://github.com/uni-ku/root) - 解决 uni-app 无法使用根部组件问题
