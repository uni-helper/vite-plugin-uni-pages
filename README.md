<a href="https://uni-helper.js.org/vite-plugin-uni-pages"><img src="./banner.svg" alt="banner" width="100%"/></a>

<br >
<a href="https://github.com/uni-helper/vite-plugin-uni-pages/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge"></a>
<a href="https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/dm/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge"></a>
<a href="https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages"><img src="https://img.shields.io/npm/v/@uni-helper/vite-plugin-uni-pages?colorA=005947&colorB=eee&style=for-the-badge"></a>


在 Vite 驱动的 uni-app 上使用基于文件的路由系统。

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

📖 **请阅读[完整文档](https://uni-helper.js.org/vite-plugin-uni-pages)了解完整使用方法！**

```ts
// vite.config.ts
import Uni from '@dcloudio/vite-plugin-uni'
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

- [vite-plugin-pages](https://github.com/hannoeru/vite-plugin-pages.git)


