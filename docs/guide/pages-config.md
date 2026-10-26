# pages.config

`pages.config.ts` 用来写 `pages.json` 里与具体页面无关的配置，例如 `globalStyle`、`tabBar`、`easycom` 和手写的 `subPackages`。

## 创建配置文件

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

`defineUniPages` 只提供类型提示，返回值就是传入的对象。

默认查找 `pages.config`，支持以下扩展名：

```text
pages.config.ts
pages.config.mts
pages.config.cts
pages.config.js
pages.config.cjs
pages.config.mjs
pages.config.json
```

<Badge type="tip" text="v0.6.0 新增" /> 配置文件可以导入本地模块，开发期间修改这些依赖会重新生成 `pages.json`，详见[配置依赖热更新](../advanced/config-dependencies.md)。

## 可用字段

配置对象和 `pages.json` 的结构一一对应：

```ts
export default defineUniPages({
  pages: [], // 手写页面条目
  globalStyle: {},
  tabBar: {},
  subPackages: [],
  easycom: {},
  condition: {},
  preloadRule: {},
})
```

其中 `pages`、`subPackages` 和 `tabBar` 会和扫描结果合并，其他字段原样写进 `pages.json`。`tabBar` 的规则见下文，完整的 `pages.json` 类型由 `@uni-helper/uni-pages-types` 提供。

## 覆盖页面配置

`pages.config.ts` 中的 `pages` 条目优先级最高：

```ts
export default defineUniPages({
  pages: [
    {
      path: 'pages/index/index',
      style: {
        navigationBarTitleText: '配置里的标题',
      },
    },
  ],
})
```

同一个页面同时被扫描到和手工写入时，两条会合并。配置里写出的属性覆盖 `definePage`，没写的属性继续使用扫描结果。

只写配置、不存在的页面也会保留。`mergePages: false` 时，插件完全不扫描页面文件，`pages` 和 `subPackages` 都以配置为准。

### 分包页面路径

配置里 `subPackages[].pages[].path` 按 `pages.json` 的惯例相对 `root` 书写：

```ts
export default defineUniPages({
  subPackages: [
    {
      root: 'pkg',
      pages: [
        { path: 'detail' }, // 实际路由是 pkg/detail
      ],
    },
  ],
})
```

同一个页面被扫描到时，两条会按路径合并，手工条目的 `style` 等属性覆盖扫描结果。

## tabBar

配置里的 `tabBar.list` 可以和页面里的 `definePage({ tabBar })` 混用：

- 两边都有同一个 `pagePath` 时，以配置里的条目为准
- 只在 `definePage` 里声明的条目会补到列表里
- `tabBar` 的其他属性由配置决定

多个平台同时往一个 `pages.json` 写入时，`list` 的顺序和顶层属性会按平台分别保存，详见[多平台与条件编译](../advanced/multi-platform.md)。

## 自定义配置来源

<Badge type="tip" text="v0.2.7 新增" />

`configSource` 决定从哪里加载配置，默认 `'pages.config'`：

```ts
UniPages({
  configSource: {
    files: 'config/pages',
  },
})
```

也可以传数组，按顺序加载第一个有效配置：

```ts
UniPages({
  configSource: [
    { files: 'pages.config' },
    { files: 'vite.config', rewrite: config => config?.UniPages },
  ],
})
```

需要自己读取或转换入口时，可以提供 `parser` 和 `transform`。加载顺序、依赖跟踪和限制见[配置依赖热更新](../advanced/config-dependencies.md)。

## 按平台写配置

配置文件在构建期的 Node 进程里执行，可以直接读环境变量：

```ts
const platform = process.env.UNI_PLATFORM

export default defineUniPages({
  globalStyle: {
    navigationBarTitleText: platform === 'h5' ? 'H5' : '小程序',
  },
})
```

不要依赖配置对象上的 `// #ifdef` 注释。条件编译由 uni-app 处理 `pages.json` 时执行，写在 TypeScript 配置里不会生效。需要按平台区分页面配置时，优先使用 [definePage 的条件 DSL](./define-page.md#函数式写法)。

## 下一步

- [插件选项](../api/options.md)
- [生命周期钩子](../api/hooks.md)
