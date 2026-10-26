---
title: "vite-plugin-uni-pages 更新了什么"
description: "vite-plugin-uni-pages 先后发布 v0.4 和 v0.5：转向 ESM-only、新增 definePage 条件 DSL，多终端并发写 pages.json 不再互相覆盖。"
date: "2026-09-04"
author: ModyQyW
authorUrl: "https://github.com/ModyQyW"
outline: deep
---

# vite-plugin-uni-pages 更新了什么

<p class="blog-post-meta">{{ $frontmatter.date }} · <a :href="$frontmatter.authorUrl" target="_blank" rel="noreferrer noopener">{{ $frontmatter.author }}</a></p>

![vite-plugin-uni-pages 更新了什么封面图](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-09-04-vite-plugin-uni-pages-cover.webp)

`vite-plugin-uni-pages`，全称是 `@uni-helper/vite-plugin-uni-pages`，它让你可以用 TypeScript 书写 uni-app 的全局文件 `pages.json`，支持约定式路由，页面级配置则通过 `definePage` 宏写在 `.vue` 文件里。

我在 2026 年 6 月 9 日发布了 v0.4.0，又在 8 月 27 日发布了 v0.5.0，中间还穿插了 v0.4.1 到 v0.4.9 的多个补丁版本。距离 v0.4 发布已经过去快三个月，不少项目可能还在用 v0.3，这篇文章就来完整梳理相关的改动、背后的原因以及升级时的注意事项。

## 都改了什么

### v0.4 清理旧写法，拆分独立包

v0.3 及更早版本中，页面级配置要写在 `<route>` 自定义块里，灵感来自 `vite-plugin-pages`。但这种方式有两个明显问题：一是缺乏即时、完善的 TypeScript 类型校验；二是完全依赖 `Vue Language Tools` 及底层的 `Volar.js` 提供编辑器提示，耦合严重。

`Volar.js` 在 v2 废弃了自定义块的相关支持（参考 [该 issue](https://github.com/vuejs/language-tools/issues/4709)），直接导致负责提供编辑器提示的独立 Volar 服务包 `@uni-helper/volar-service-uni-pages` 不可用。因此，v0.3.3 起运行时会输出废弃警告并建议迁移到 `definePage` 宏。

v0.4 彻底移除了 `<route>` 自定义块和配套的 `routeBlockLang` 选项。旧项目中写在 `<route>` 块里的配置不会再被解析、需要手动挪进 `<script setup>` 的 `definePage` 调用里，Vite 插件配置里的 `routeBlockLang` 也需要删掉。

页面级配置统一写进 `<script setup>` 顶层的 `definePage` 编译期宏。它的设计类似于 Vue 的 `defineProps`、`defineModel` 等宏，上手成本很低，也更贴合社区趋势（最新版 `vue-router` 也已支持同名宏），可以直接复用 TypeScript 的原生类型提示和语法校验。这里特别感谢 [Edwin](https://github.com/edwinhuish/) 提交 PR 引入 `definePage` 宏🙏

v0.4 还把类型和 Schema 拆成了两个独立的包：`@uni-helper/uni-pages-types` 提供 `pages.json` 对应的 TypeScript 类型，`@uni-helper/pages-json-schema` 提供对应的 JSON Schema。这样解耦之后，核心插件本身的依赖体积更小；如果你的脚本、服务端工具或者 monorepo 分包只需要校验或标注 `pages.json`，直接单独安装这两个轻量包就行，不需要安装 Vite 插件。

![v0.4：route 自定义块改为 definePage 宏，类型与 Schema 拆成独立包](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-09-04-vite-plugin-uni-pages-route-to-definepage.webp)

其它一些改动还包括：

- `@uni-helper/uni-pages-types` 补齐了鸿蒙（`app-harmony`、`mp-harmony`）和小红书（`mp-xhs`）等平台的字段类型，写这些平台的差异化配置时有了完整的代码补全和校验；
- 文件扫描底层由 `fast-glob` 替换为 `tinyglobby`，依赖更轻、扫描更快，原有配置项（如 `dir`、`exclude`）保持兼容，不用改动任何配置；
- `definePage` 支持直接声明当前页面对应的 `tabBar` 字段，方便就近维护；分包扫描时也会把分包配置里的 `plugins` 字段原样保留进 `pages.json`，解决了微信小程序等平台第三方插件的配置没有进入 `pages.json` 的问题。

### v0.5 转向 ESM-only 和多终端并发

v0.5 版本之前，插件同时提供 CJS 和 ESM 两种产物。v0.5 起只保留 ESM（`.mjs` 和 `.d.mts`），清理了 `json5`、`yaml`、`detect-indent` 等运行时依赖，包体积更小，也更符合社区的演进方向。宏解析底层升级到了 Babel 8，只支持标准的 `with { ... }` 语法，废弃的 `assert { ... }` 导入属性语法不再支持，性能略微提升。受 ESM-only 和 Babel 8 升级影响，Node.js 版本要求提高到了 `^22.22.2 || ^24.15.0 || >=26.0.0`。

![v0.5：从 CJS 加 ESM 双出口变为 ESM-only](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-09-04-vite-plugin-uni-pages-esm-only.webp)

要处理 ESM-only 这个破坏性改动，你可能需要调整你的 Vite 配置文件。

```ts
// vite.config.mts

import dcloudioUni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

// DCloudio 官方仍然只提供 CJS 包，所以需要额外处理
const Uni = dcloudioUni.default || dcloudioUni

// 也可以直接使用我们提供的 ESM 包装
// import Uni from '@uni-helper/plugin-uni'

export default defineConfig({
  plugins: [
    UniPages(), // 需要在 Uni() 之前调用
    Uni(),
  ],
})
```

`definePage` 是这次更新的主角。以前所有平台共用一份页面配置，遇到平台差异要靠 `process.env.UNI_PLATFORM` 自己写判断，特定端独有的页面也没法按端跳过，导致其他平台也被迫注册了多余的路由。

v0.5 起 `definePage` 支持函数式写法，接收当前平台 `platform` 和条件工厂 `define`，通过 `.ifdef()`、`.ifndef()` 链式声明平台差异。条件分支按声明顺序深合并进基础配置，对象递归合并，数组与原始值直接替换。`h5` 和 `web` 自动作为同名别名互通，插件在扫描阶段就会把它解析成当前平台的普通对象。

```vue
<script setup lang="ts">
definePage(({ define }) =>
  define({
    style: { navigationBarTitleText: '标题', enablePullDownRefresh: false },
  })
    // 微信小程序导航栏换成绿色
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    // h5 和 web 不注入中间件
    .ifndef(['h5', 'web'], { middlewares: ['auth'] }),
)
</script>
```

函数返回或者直接传入 `null`，可以让当前平台完全不注册这个页面，最终生成的 `pages.json` 不会包含该页面条目：

```vue
<script setup lang="ts">
definePage(({ platform }) => {
  // 仅小程序端注册该页面
  if (platform === 'h5' || platform === 'web')
    return null
  return { style: { navigationBarTitleText: '仅小程序' } }
})
</script>
```

宏求值底层也做了增强，宏参数里引用的外部导入现在支持跨 `<script>` 和 `<script setup>` 两个块解析并在构建时自动执行。注意导入路径要写全扩展名（如 `./title.mjs` 或 `./title.ts`），因为宏代码在构建期是由 Node 运行时动态执行解析的，不会做 TypeScript 的扩展名自动补全。

这部分功能重度参考了 [@uni-ku/pages-json](https://github.com/uni-ku/pages-json)，在这里也特别感谢 [Edwin](https://github.com/edwinhuish/) 和 [uni-ku 团队](https://github.com/uni-ku) 的工作🙏

另一件大事是多终端并发。日常跨端开发时，我们经常会在多个终端窗口里同时启动不同平台的开发服务，比如一边开着微信小程序，另一边开着 H5 或支付宝小程序，一边写代码一边看多端实时效果。

在过去，由于每个平台的构建进程都会去读写同一个 `pages.json`，多进程并发下轻则互相覆盖对方写好的条件编译内容，重则读到写入一半的损坏文件导致编译崩溃。删掉某个页面或分包后，旧平台写过的条目也会残留在文件里，甚至留下空壳分包导致报错。

为了让多端并行调试真正可用，v0.5 彻底重构了 `pages.json` 的更新机制：把读取、合并、写回的完整流程放进文件锁（`withFileLock`），写入时先写临时文件再原子替换（tmp + rename）。写回时会完整保留其他平台已写入的 `#ifdef` 条件编译块，只更新当前平台涉及的内容。当多个平台的页面配置完全相同时，自动合并为一条联合平台语句（比如 `H5 || MP-WEIXIN`），不会留下重复路由。

![v0.5：多终端并发下用文件锁串行读取、合并、原子写回 pages.json](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-09-04-vite-plugin-uni-pages-concurrency-lock.webp)

tabBar 的 `color`、`selectedColor`、`custom`、`position`、`midButton` 等外观属性也改为按平台分别记录：各平台取值不同时各自包在 `#ifdef` 块里，取值相同时合并为一条无条件属性。每次写入前还会比对磁盘上的已有内容，内容没有实质变化就跳过写入，避免触发下游不必要的重复编译。这里有个例外，设置 `minify: true` 时的产物无法带上条件编译注释，属性会变成最后写入的说了算，所以同一个项目所有平台的构建命令要保持一致的格式化设置。

为了清理过期配置，插件在 `pages` 数组和每个 `subPackages` 头部写入了 `// GENERATED BY UNI-PAGES, PLATFORM: ...` 格式的生成标记，记录写入过该数组的平台全集，只增不减。基于这个标记，主包里当前平台已不存在的页面会从平台列表里剔除；如果某个分包里的页面全被删除或者被 `definePage(null)` 跳过，整个分包条目会自动从 `pages.json` 里删掉，避免留下空壳。没有生成标记的条目会被当成手写内容，插件永远不会修改或删除，所以别手动删这些标记行，删了对应条目过期后就不再被清理。想清空历史残留的平台标记，直接删掉 `pages.json` 重新跑构建即可。

v0.5 也补齐了格式化选项，新增了 `indent`（缩进）、`eol`（换行符）和 `insertFinalNewline`（文件末尾换行）三个插件选项。加上原有的 `minify` 插件选项，生成的 `pages.json` 格式完全可控，能对齐团队的 EditorConfig 或 Prettier 规范，减少无谓的 git 冲突，同时也避免旧版自动检测策略带来的性能损耗。

v0.5 的类型入口也有一个破坏性变化。以前在 `tsconfig.json` 的 `types` 里写包名，会隐式带上 `definePage` 全局类型和 `virtual:uni-pages` 的模块声明，容易造成全局命名空间污染。v0.5 的包主入口类型直指构建产物，要改用 `/client` 子路径引入：

```ts
// env.d.ts
/// <reference types="vite/client" />
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
```

生命周期钩子的签名也变了，不再接收整个宽泛的 `PageContext` 实例，改成按阶段传入具体的数据（比如 `onAfterScanPages(pages, subPages)`、`onBeforeWriteFile(filePath)`），隔离了内部上下文状态。用到了自定义钩子的项目对照 README 里的对照表调整一下参数即可。

还有两处类型修正：`@uni-helper/uni-pages-types` 里 `softInputMode`、`softInputNavBar` 改成了官方规范拼写 `softinputMode`、`softinputNavBar`，`pages.json` 里写过旧字段的话要手动改一下。`globalStyle` 移除了 `disableScroll` 和 `disableSwipeBack`，官方文档注明这两个配置只在页面级 `style` 中有效，写在 `globalStyle` 里本来就无效，现在类型也不再提供。

![v0.5：类型入口改为 /client 子路径，globalStyle 移除 disableScroll 与 disableSwipeBack](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-09-04-vite-plugin-uni-pages-types.webp)

最后，已存在的 `pages.json` 如果不是普通文件（例如被误建成了目录）或者缺少读写权限，插件现在会直接报错并停止生成。v0.4 遇到这种情况会把它删掉重建为占位内容，容易导致手写配置静默丢失。

## 其它的一些碎碎念

v0.5 的多终端并发，最早是从社区 issue 里一件件堆出来的：[monorepo 分包下的自定义 root](https://github.com/uni-helper/vite-plugin-uni-pages/issues/271)、[多端并发导致页面条目重复](https://github.com/uni-helper/vite-plugin-uni-pages/issues/283)、[条件编译下丢失 `type` 字段](https://github.com/uni-helper/vite-plugin-uni-pages/issues/284)。合并逻辑的边缘情况比想象中多，v0.5.0 光新增的测试代码就有四千多行，README 里那段合并规则说明，就是这些边缘情况的完整版。

另一个常见问题是 `pages.json` 写了但不生效。`@dcloudio/vite-plugin-uni` 在更早的 `config` 钩子里通过 `parsePagesJsonOnce` 读取并缓存了配置，而本插件作为常规 Vite 插件在更晚的 `configResolved` 钩子里才写入，此时官方插件的内存缓存已经固定，插件写得再快也抢不过去。要解决这个时序问题，得在 uni 命令启动前把文件生成好。README 的 FAQ 给了几种方案，推荐直接使用 [@uni-helper/unh](https://uni-helper.cn/unh/auto-generate)，它会在 `uni dev/build` 之前自动完成配置扫描和写盘。

下一步，`vite-plugin-uni-pages` 要看看怎么支持 `uni-app x`，预计 v0.6 会发布相关支持。

最后照例打一下广告。如果这篇文章或者 uni-helper 系列插件对你有帮助，请考虑 [持续赞助我](https://modyqyw.top/sponsors)，这有利于项目的持续维护。我会给 uni-helper 服务器续费以及二次分配给 uni-helper 团队成员和其它开源项目成员，非常感谢🙏

希望对你有所帮助！下次见！

## 相关链接

- [vite-plugin-uni-pages 文档](https://uni-helper.cn/vite-plugin-uni-pages/)
- [vite-plugin-uni-pages 仓库](https://github.com/uni-helper/vite-plugin-uni-pages)

---

[← 返回博客](/blog/)
