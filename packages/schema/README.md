# @uni-helper/pages-json-schema

为 uni-app 的 `pages.json` 提供 schema。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/vite-plugin-uni-pages"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

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

- [@uni-helper/vite-plugin-pages](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/core) - 使用 TypeScript 编写 uni-app 的 pages.json，支持约定式路由
- [@uni-helper/pages-json-schema](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/schema) - 为 uni-app 的 pages.json 提供 schema
- [@uni-helper/uni-pages-types](https://github.com/uni-helper/vite-plugin-uni-pages/tree/main/packages/types) - 为 uni-app 的 pages.json 提供 TypeScript 类型
- [uni-helper/vite-plugin-uni-manifest](https://github.com/uni-helper/vite-plugin-uni-manifest) - 使用 TypeScript 来编写 uni-app 的 manifest.json
- [uni-helper/vite-plugin-uni-platform](https://github.com/uni-helper/vite-plugin-uni-platform) - 基于文件名 (*.<h5|mp-weixin|app>.*) 的按平台编译插件
- [uni-helper/vite-plugin-uni-platform-modifier](https://github.com/uni-helper/vite-plugin-uni-platform-modifier) - 为属性、指令提供平台修饰符并按需编译
- [uni-helper/vite-plugin-uni-layouts](https://github.com/uni-helper/vite-plugin-uni-layouts) - 为 Vite 下的 uni-app 提供类 nuxt 的 layouts 系统
- [uni-ku/root](https://github.com/uni-ku/root) - 解决 uni-app 无法使用根部组件问题
