# 起步

## 安装

::: code-group

```shell [pnpm]
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

```shell [npm]
npm i -D @uni-helper/vite-plugin-uni-pages
```

```shell [yarn]
yarn add -D @uni-helper/vite-plugin-uni-pages
```

:::

## 注册插件

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

`UniPages()` 必须排在 `Uni()` 前面。否则 uni-app 会在插件生成 `pages.json` 之前读取到旧内容。

## 创建页面

默认扫描 `src/pages`，新项目可以直接创建页面文件：

```text
src/
└── pages/
    ├── index.vue
    └── about.vue
```

运行开发或构建命令后，插件会生成 `src/pages.json`：

```json
{
  "pages": [
    { "path": "pages/index" },
    { "path": "pages/about" }
  ]
}
```

`pages/index` 会作为首页排在最前面。

## 编写全局配置

创建 `pages.config.ts`，用 `defineUniPages` 获得类型提示：

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'

export default defineUniPages({
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: 'uni-helper',
  },
})
```

## 配置编译平台

插件在初始化时读取 `process.env.UNI_PLATFORM`，例如 `h5`、`mp-weixin`、`app`。通过 uni-app 的开发或构建命令启动时会自动设置。

如果直接用 Vite 启动或编写独立脚本，需要先设置平台：

```shell
UNI_PLATFORM=h5 vite
```

没有设置平台时，插件会直接报错并停止生成。

## 类型提示

如果编辑器不认识 `definePage` 全局宏或 `virtual:uni-pages` 模块，在项目的声明文件里引用 `/client`：

```ts
// env.d.ts
/// <reference types="vite/client" />
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
```

也可以在 `tsconfig.json` 里设置：

```json
{
  "compilerOptions": {
    "types": ["@uni-helper/vite-plugin-uni-pages/client"]
  }
}
```

## 下一步

- [使用](./usage.md)
- [definePage](./define-page.md)
- [pages.config](./pages-config.md)
