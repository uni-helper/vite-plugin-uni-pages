# 使用

## 目录约定

插件默认扫描 `src/pages`，`pages.json` 输出到 `src`。这两个位置都可以配置：

```ts
UniPages({
  dir: 'src/pages',
  outDir: 'src',
})
```

`dir` 支持 glob，一次扫描多个目录：

```ts
UniPages({
  dir: 'src/{pages,views}',
})
```

页面文件只支持 `.vue`、`.nvue`、`.uvue`。生成 `pages.json` 时，路径相对于 `outDir` 计算，并去掉文件扩展名。

## 首页

首页按以下顺序确定：

1. 页面配置里写了 `type: 'home'`，可以来自 `definePage` 宏，也可以来自 `pages.config.ts` 的 `pages` 条目
2. 配置里的 `homePage`，默认 `['pages/index', 'pages/index/index']`

都找不到时，插件会输出警告，页面仍会生成，但不会主动调整顺序。

## 页面配置的优先级

同一个页面的配置会从三个来源合并：

```text
pages.config.ts 的 globalStyle
  → definePage() 宏
  → pages.config.ts 的 pages 数组中的同名条目
```

后面的来源覆盖前面的同名属性。`pages.config.ts` 的 `pages` 只覆盖它写出来的字段，扫描出的其他字段会保留。

如果关掉自动扫描：

```ts
UniPages({
  mergePages: false,
})
```

插件只加载 `pages.config.ts`，完全不读取页面文件，页面和分包条目都由配置手工维护。

## 读取页面元数据

插件会生成 `uni-pages.d.ts`，为 `navigateTo`、`redirectTo`、`switchTab`、`reLaunch` 提供路径类型。关闭方式：

```ts
UniPages({
  dts: false,
})
```

自定义输出路径：

```ts
UniPages({
  dts: 'src/typings/uni-pages.d.ts',
})
```

相对路径以项目根目录为基准。

业务代码也可以通过虚拟模块读取当前页面列表：

```ts
import { pages, subPackages } from 'virtual:uni-pages'
```

虚拟模块的导出不保证稳定，可能在小版本中调整，详见[虚拟模块](../api/virtual-module.md)。

## 提前生成 pages.json

有些下游插件在工厂函数执行时就会读取 `pages.json`。可以在创建它们之前等待 `prepare()`：

```ts
import Uni from '@uni-helper/plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import Optimization from '@uni-ku/bundle-optimizer'
import { defineConfig } from 'vite'

export default defineConfig(async () => ({
  plugins: [
    await UniPages().prepare({ platformSuffix: false }),
    Uni(),
    Optimization(),
  ],
}))
```

`platformSuffix` 必填，必须和最终是否启用 `@uni-helper/vite-plugin-uni-platform` 一致。完整行为和限制见 [prepare()](../api/prepare.md)。

## 开发期间发生什么

开发服务器启动时，插件会：

- 监听页面文件的新增、修改和删除，增量更新 `pages.json`
- 监听 `pages.config` 及其本地依赖，变更后重新生成
- 监听页面目录结构，自动发现新增或删除的分包目录
- 监听符号链接目标，页面指向变化后重新扫描
- 更新虚拟模块并触发浏览器整页刷新

生成失败只记录错误，不会终止开发服务器。修复文件后会继续更新。

## 下一步

- [definePage](./define-page.md)
- [pages.config](./pages-config.md)
- [多平台与条件编译](../advanced/multi-platform.md)
