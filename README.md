# @uni-helper/vite-plugin-uni-pages

**WIP** 在 Vite 驱动的 uni-app 上使用基于文件的路由系统

## 安装

```bash
pnpm i -D @uni-helper/vite-plugin-uni-pages
```

## 使用

```ts
// vite.config.ts
import { defineConfig } from "vite";
import Uni from "@dcloudio/vite-plugin-uni";
import UniPages from "@uni-helper/vite-plugin-uni-pages";
// 推荐放置在 Uni 前面
export default defineConfig({
  plugins: [UniPages(), Uni()],
});
```

定义全局属性

```ts
// pages.config.ts
import { definePages } from "@uni-helper/vite-plugin-uni-pages/config";

export default definePages({
  // 你也可以指定 pages，内容将会被合并
  pages: []
  globalStyle: {
    navigationBarTextStyle: "black",
    navigationBarTitleText: "@uni-helper",
    navigationBarBackgroundColor: "#F8F8F8",
    backgroundColor: "#F8F8F8",
  },
});
```

现在所有的 pages 将会被自动发现！

你可以在页面中使用 route block 来指定元数据

```vue
<!-- index.vue -->
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

导入虚拟模块即可访问所有页面的 meta-data

```ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
import { pages } from "virtual:uni-pages";
```

## TODO

- [ ] only update the changed page
- [ ] ~~middleware~~
  - vite-plugin-uni-middleware
- [ ] pages [type](./src/config/types.ts)
