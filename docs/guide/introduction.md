# 介绍

`@uni-helper/vite-plugin-uni-pages` 用 TypeScript 和约定式路由生成 `uni-app` 的 `pages.json`。

uni-app 的页面需要手工维护在 `pages.json` 里。页面一多，路由、样式和分包配置容易和目录结构脱节。这个插件把页面目录作为唯一来源：

- 扫描 `src/pages` 等目录，把 `.vue`、`.nvue`、`.uvue` 文件转换成 `pages` 条目
- 从页面文件里的 `definePage` 宏读取页面级配置
- 用 `pages.config.ts` 编写 `globalStyle`、`tabBar`、`subPackages` 等全局配置
- 合并多个平台写进同一个 `pages.json` 的条件编译块
- 生成 `uni-pages.d.ts`，约束导航 API 的 URL 类型
- 提供 `virtual:uni-pages` 虚拟模块，供业务代码读取页面元数据

## 和 uni-app 的关系

插件的输出仍然是普通的 `pages.json`，uni-app 官方插件按原有方式读取它。插件只负责在构建和开发阶段把文件生成好，不改变 uni-app 的页面运行机制。

插件必须在 `Uni()` 之前注册：

```ts
import Uni from '@uni-helper/plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    UniPages(),
    Uni(),
  ],
})
```

## 运行要求

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`
- Vite `^5.0.0`
- 仅支持 ESM 引入，不再提供 CommonJS 入口

## 版本标记

文档里的 `vX.Y.Z 新增` 表示功能首次加入的版本，`vX.Y.Z 变更` 表示行为在该版本发生过变化。侧边栏的版本徽标对应页面的主要功能，绿色表示新增，黄色表示变更。具体条目的版本以正文徽标和选项表为准。

## 接下来

- [起步](./installation.md)：安装并在项目里跑通
- [使用](./usage.md)：了解目录约定和基本工作流
- [definePage](./define-page.md)：页面级配置和按平台分支
- [pages.config](./pages-config.md)：全局配置的写法
