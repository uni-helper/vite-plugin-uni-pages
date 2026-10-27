---
title: "vite-plugin-uni-pages 0.6：统一扫描规则，开发期少重启"
description: "0.6 统一了 exclude 和扫描来源规则，补上 prepare()、配置依赖热更新和分包目录 glob，重构了页面监听与会话生命周期，并为 uni-app x 补齐 pages.json 类型。"
date: "2026-10-26"
author: ModyQyW
authorUrl: "https://github.com/ModyQyW"
outline: deep
---

# vite-plugin-uni-pages 0.6：统一扫描规则，开发期少重启

<p class="blog-post-meta">{{ $frontmatter.date }} · <a :href="$frontmatter.authorUrl" target="_blank" rel="noreferrer noopener">{{ $frontmatter.author }}</a></p>

![vite-plugin-uni-pages 0.6 封面](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-uni-pages-0-6.webp)

0.5 处理的是多终端并发写 `pages.json`：文件锁、原子写入、按平台的 `#ifdef` 块。那之后暴露出来的麻烦在别处。扫描来源的规则不统一，同一个页面可能被两个分包认领却没有提示。开发期间改配置依赖、改符号链接、新建分包目录，经常要重启。需要读 `pages.json` 的下游插件又总是抢在生成之前执行。

## 升级前先看：四个破坏性变更

### `exclude` 改为相对 Vite root

0.5 及更早，`exclude` 相对每个实际扫描目录解释。`index.vue` 这条规则在 `src/pages` 和 `../shared/pages` 下各算一次。0.6 统一以 Vite `root` 为基准，规则命中文件、目录或任一祖先目录时排除整个子树。主包、字面分包、glob 分包、带 root 回调的分包用同一套规则，首次扫描和后续页面事件也一致。

旧规则要补上扫描来源的前缀：

```ts
// 0.5
exclude: ['index.vue']

// 0.6：扫描 src/pages、src/packages/*/pages、../shared/pages 时
exclude: [
  'src/pages/index.vue',
  'src/packages/*/pages/index.vue',
  '../shared/pages/index.vue',
]
```

`**/index.vue` 看着能替代，实际会多排除嵌套页面，也覆盖不到根外来源。默认值同时从 `['node_modules', '.git', '**/__*__/**']` 改成 `['**/node_modules/**', '**/.git/**', '**/__*__/**']`，项目根子树里任意层的依赖目录都会被排除。页面放在依赖里的来源，比如 pnpm link 或 workspace 包里的 `node_modules/@scope/ui/pages`，默认一条也扫不到，需要显式传 `exclude: []` 或缩小默认值。

`!foo` 这类否定规则现在直接报错，`!(keep).vue` 仍然可用。

![0.5 每个扫描目录各匹配一次 exclude，0.6 在 Vite root 下统一匹配](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-exclude-basis.webp)

### 扫描来源与页面归属统一

0.5 里多个目录落到同一 root 时，后扫描的页面会盖掉前面的；同一物理页面被两个分包 root 认领时也没有提示。0.6 用 realpath 判断目录和页面身份，规则固定为：

- 同一目录的显式 `root` 优先于默认值，多个不同的显式值报错
- 同一页面归属同一 root 时只保留一份代表来源
- 主包和分包同时命中时，有效分包优先
- 同一页面被不同 root 认领、不同来源占用同一完整路由时报错，冲突结果不写进 `pages.json`

升级后，静态目录共用同一 root 的项目会发现以前被盖掉的页面重新出现。先看一遍分包产物，不需要的页面删掉声明或用 `exclude` 排除。`.vue`、`.nvue`、`.uvue` 格式变体，以及主包的平台后缀页面，本来就会落到同一个路径，不算路由冲突。

### 一个实例只服务一个 Vite 会话

从 `configResolved` 到会话关闭，一个 `UniPages()` 实例只接受一个 Vite 会话。开发服务器还开着又启动构建、构建没结束又启动另一个、`build --watch` 期间再次启动、程序化 `server.restart()` 复用同一实例，都会报错。普通构建结束、`server.close()` 完成或 watcher 关闭后可以顺序复用，下一次会重新读取配置和页面。

嵌套构建、并行任务和重启场景各自调用 `UniPages()` 创建实例。`build --watch` 每轮的 `closeBundle` 不会释放会话，要等整个 watcher 关闭。

![一个实例只服务一个 Vite 会话：重叠会话被拒绝，关闭后可复用，build --watch 期间保持会话](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-instance-session.webp)

### `UNI_PLATFORM` 必填，路径基准统一

初始化读不到 `process.env.UNI_PLATFORM` 会直接报错。0.5 会以空平台继续生成，条件编译分支全部跳过，产物不对也不提示。通过 uni-app 的命令启动时这个变量总是存在，自己写脚本调用 `prepare()` 时要先设置。

用脚本直接调 API 的项目还要看路径基准。Vite `root` 在解析阶段固定为绝对路径，之后切换 `process.cwd()` 不再影响扫描和排除。`dts` 传字符串时相对 Vite root 解析，0.5 是相对当前工作目录直接写。`dts: true` 的默认输出路径也改为相对解析后的 root。`getPageFiles(directory, options)` 的 `directory` 相对 `options.root` 解析，0.5 相对 `process.cwd()`。

## 新能力

### `prepare()`：在 uni-app 读取之前生成

`@dcloudio/vite-plugin-uni` 在自己的 `config` 钩子里读取并缓存 `pages.json`，本插件写入发生在更晚的 `configResolved`。这个时序问题 [FAQ](/other/faq) 里推荐用 [@uni-helper/unh](https://uni-helper.cn/unh/auto-generate) 在启动 uni 命令前生成。0.6 给插件加了 `prepare()`，可以在创建下游插件之前等一次完整生成：

```ts
// vite.config.mts
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

数组按顺序求值，`Optimization()` 会在准备完成后才执行。`platformSuffix` 必填，要和最终是否启用 `@uni-helper/vite-plugin-uni-platform` 一致。准备阶段读取调用时的 `UNI_PLATFORM`，Vite 还没加载 `.env`，配置要用到其中的变量时先用 `loadEnv()`。`prepare()` 不会刷新下游插件已经缓存的配置，需要完整配置的插件要放在它后面创建。

![prepare() 在 config 钩子读取之前生成 pages.json；0.5 的顺序会读到旧文件](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-prepare-timing.webp)

### 配置依赖热更新

`pages.config.ts` 可以导入本地模块，开发服务器和 `vite build --watch` 会监听入口和依赖，改完重新生成 `pages.json` 和类型声明：

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'
import { globalStyle } from './config/global-style'

export default defineUniPages({ globalStyle })
```

支持 TypeScript、JavaScript、JSON，静态 `import`、`export ... from`、字面量 `import()` 和 `require()`。workspace 包里真实路径在 `node_modules` 之外的源码也会参与监听和重新求值。新增导入后会更新监听集合，移除导入后不再触发。

配置里用变量加载的目标，比如 `const target = './title.mjs'; await import(target)`，交给 Node 运行时解析，沿用 Node 缓存，不会自动加入监听。相对路径以发起调用的模块位置为准，`__dirname`、`import.meta.url`、`import.meta.dirname` 这些也指向各自的源文件。可枚举的模板路径，比如 ``import(`./titles/${locale}.mjs`)``，会展开成候选文件一起监听，一个候选都不存在时打包失败，创建文件后要改配置入口或重启。

依赖出现语法错误或缺失时，watch 模式保留上次成功的产物并报错，修好继续更新。更细的边界在[配置依赖热更新](/advanced/config-dependencies)。

### 分包目录 glob 和 root 回调

`subPackages` 的字符串和对象 `dir` 现在都支持 glob。启动时目录还不存在，运行中新增、删除、改名，都会重新发现：

```ts
UniPages({
  subPackages: ['src/packages/*/pages'],
})
```

目录名里带 `[`、`]` 这类 glob 元字符时要转义，写成 `app\\[prod\\]/src/pages` 这种形式。

monorepo 里页面在项目根之外时，默认 root 会带 `..`，uni-app 不认。对象形式可以指定写进 `pages.json` 的 root，也可以传同步回调：

```ts
import { posix } from 'node:path'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

UniPages({
  subPackages: [{
    dir: 'src/packages/*/pages',
    root: dir => posix.relative('src', posix.dirname(dir)),
  }],
})
```

`src/packages/account/pages/profile.vue` 会生成 root `packages/account`、页面 path `pages/profile`。root 只决定写进 `pages.json` 的 `subPackages.root`，页面 path 仍然按文件相对 `outDir` 的实际位置换算。根外目录的 path 会带 `..`，和 root 拼起来正好是源文件的位置，uni-app 靠这个组合定位页面。规则和迁移细节见[分包](/advanced/subpackages)。

![分包 glob 匹配目录并映射到 root，root 与页面 path 组合定位源文件](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-subpackage-root.webp)

### 页面监听：链接、重建和增量读取

0.6 把页面内容监听从 Vite 的共享 watcher 里拆了出来。插件自己订阅解析后的物理目标，配置文件事件和目录结构通知仍由 Vite 的共享 watcher 负责（`build --watch` 下是构建 watcher）。这样符号链接页面能跟着改：链接改指到新目录、目标删除后重建、目录里再套链接，都会继续更新 `pages.json`。悬空链接和循环链接按暂不可用处理，恢复后下一轮重新发现。单轮来源发现最多登记 1024 个链接来源，超过后告警并停止展开，页面生成不受影响。

普通内容修改只重读与这个物理文件关联的页面，元数据没变就跳过配置加载和写盘。新增、删除、链接改指、watcher 恢复这类结构变化才走完整扫描，生成期间到达的事件合并到下一轮。H5 开发时，Vite 的 `server.watch.ignored`、`usePolling`、`interval`、`awaitWriteFinish`、`atomic` 会转发给内容 watcher，`CHOKIDAR_USEPOLLING` 和 `CHOKIDAR_INTERVAL` 也认。

开发期间配置或依赖出错、扫描冲突时，`pages.json` 保留上一次成功的内容，错误只记录日志，不会终止开发服务器。首次加载失败仍会终止初始化。修好文件后继续更新。监听细节和 Windows 上的注意事项见[监听与符号链接](/advanced/watchers-and-symlinks)。

![页面监听：内容变更按 metadata 决定跳过或写入，结构变化走完整扫描，符号链接改指后可恢复](https://cdn.jsdelivr.net/gh/ModyQyW/static@main/2026-10-26-page-watch.webp)

## pages.json 的几处收尾

多平台的合并规则在 0.5 就定下来了，0.6 补了几个边角：

- `tabBar.list` 按配置顺序摆放。配置覆盖全部既有条目时整体重排；没覆盖时只把新增条目插到它在配置里最近的前驱之后，既有条目保持磁盘顺序。
- 手写的 `#ifndef` 块原样保留，数组条目和 tabBar 属性都是。插件只写 `#ifdef`，不修改用户写的否定条件。
- 生成标记和过期清理沿用 0.5 的规则：没有标记的条目当手写内容，不删不改。带标记但当前平台扫描不到的页面，从平台列表里去掉；分包没有任何页面时整个删掉。

## 类型、文档和测试

`@uni-helper/uni-pages-types` 已按 uni-app x 文档补齐 `pages.json` 字段（[8c5e968](https://github.com/uni-helper/vite-plugin-uni-pages/commit/8c5e968c35047ad17cd72ec8f5e7c811e6d5e4c5)），schema 重新生成。上一篇文章最后提到 0.6 会支持 uni-app x，这个支持已经落地。`.uvue` 页面本来就在扫描范围内，页面、tabBar 和分包里的 uni-app x 字段现在也有对应的类型提示。

仓库里新增了 VitePress 文档站，按指南、API、进阶、FAQ 和迁移指南分开，带 Netlify 与 Cloudflare Pages 的部署配置。

测试文件从 29 个增加到 71 个，现在跑一遍是 690 个用例。新增的夹具用临时工作区、受控 watcher 和真实 Vite 服务器跑完整流程，页面监听、实例生命周期、配置依赖这些最容易出时序问题的部分都进了测试。

## 升级清单

1. 升级依赖，先跑一次构建，检查 `pages.json` 的差异。
2. 按 Vite root 重写 `exclude`；要保留依赖里的页面时显式关掉或缩小默认值。
3. 检查 `subPackages`：多个声明指向同一目录或页面时，处理新出现的页面和冲突报错；目录名里的 `[`、`]` 等元字符要转义。
4. 检查实例用法：并行构建、`server.restart()`、`build --watch` 期间再次启动 Vite 的地方，改成每次创建实例。
5. 脚本里补 `UNI_PLATFORM`；用了 `dts` 或 `getPageFiles` 的脚本检查路径基准。

完整规则和旧写法对照见[迁移指南](/other/migration)。

## 致谢

感谢 [@Vanisper](https://github.com/Vanisper) 提交的扫描归属、页面监听、配置依赖热更新、`prepare()` 和分包 glob 等 PR。也感谢在 [#294](https://github.com/uni-helper/vite-plugin-uni-pages/issues/294) 里做的那轮规则复核，扫描归属、配置加载、实例生命周期和页面监听的边界在那里归成了四组。

感谢 [@liujiayii](https://github.com/liujiayii) 修正配置覆盖全部条目时 tabBar 条目的落位（[#299](https://github.com/uni-helper/vite-plugin-uni-pages/pull/299)）。

感谢 [@skiyee](https://github.com/skiyee) 开发的 [oiyo](https://oiyo.js.org) 项目，分包 glob 和目录动态发现的思路来自于它。请量力赞助以维持项目持续开发。

monorepo 分包和 uni-app x 的需求分别来自 [#271](https://github.com/uni-helper/vite-plugin-uni-pages/issues/271) 和 [#293](https://github.com/uni-helper/vite-plugin-uni-pages/issues/293)，也谢谢提出这些场景的 [@shikangsheng](https://github.com/shikangsheng)、[@cq112233](https://github.com/cq112233)，以及所有提交复现和反馈的朋友。

## 相关链接

- [vite-plugin-uni-pages 文档](https://uni-helper.js.org/vite-plugin-uni-pages)
- [vite-plugin-uni-pages 仓库](https://github.com/uni-helper/vite-plugin-uni-pages)
- [问题反馈](https://github.com/uni-helper/vite-plugin-uni-pages/issues)

---

[← 返回博客](/blog/)
