<a href="https://uni-helper.js.org/vite-plugin-uni-pages"><img src="./banner.svg" alt="banner" width="100%"/></a>

<p style="text-align: center">
  <a href="https://github.com/uni-helper/vite-plugin-uni-pages/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Stars"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/dm/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="Downloads"></a>
  <a href="https://npmx.dev/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge" alt="NPM Version"></a>
</p>
<p style="text-align: center">
  <a href="https://github.com/kejunmao"><img src="https://img.shields.io/badge/Author-KeJun-blue?style=for-the-badge" alt="Author"></a>
  <a href="https://github.com/ModyQyW"><img src="https://img.shields.io/badge/Maintainer-ModyQyW-blue?style=for-the-badge" alt="Author"></a>
</p>

在 Vite 驱动的 uni-app 上使用基于文件的路由系统。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/vite-plugin-uni-pages"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

> **请考虑持续[赞助](https://github.com/ModyQyW/sponsors)以维持该项目的持续健康发展，非常感谢！🙏**

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

📖 请阅读[在线文档](https://uni-helper.js.org/vite-plugin-uni-pages)或各包 README 文档了解使用方法。

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

## 感谢

- [hannoeru/vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages)
- [uni-ku/pages-json](https://github.com/uni-ku/pages-json)

## 关联项目

- [uni-helper/vite-plugin-uni-manifest](https://github.com/uni-helper/vite-plugin-uni-manifest) - 使用 TypeScript 来编写 uni-app 的 manifest.json
- [uni-helper/vite-plugin-uni-platform](https://github.com/uni-helper/vite-plugin-uni-platform) - 基于文件名 (*.<h5|mp-weixin|app>.*) 的按平台编译插件
- [uni-helper/vite-plugin-uni-platform-modifier](https://github.com/uni-helper/vite-plugin-uni-platform-modifier) - 为属性、指令提供平台修饰符并按需编译
- [uni-helper/vite-plugin-uni-layouts](https://github.com/uni-helper/vite-plugin-uni-layouts) - 为 Vite 下的 uni-app 提供类 nuxt 的 layouts 系统
- [uni-ku/root](https://github.com/uni-ku/root) - 解决 UniApp 无法使用根部组件问题
