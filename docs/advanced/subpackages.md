# 分包

<Badge type="tip" text="v0.1.8 新增" />

`subPackages` 声明 uni-app 的分包页面目录。插件会扫描这些目录，生成 `pages.json` 的 `subPackages` 字段。

## 基本写法

```ts
UniPages({
  subPackages: ['src/packages/account', 'src/packages/order'],
})
```

每个目录的默认 `root` 相对 `outDir` 计算：

```text
src/packages/account/profile.vue
  → root: packages/account
  → page: profile
```

## glob 发现

<Badge type="tip" text="v0.6.0 新增" />

字符串和对象形式的 `dir` 都支持 glob：

```ts
UniPages({
  subPackages: ['src/packages/*/pages'],
})
```

每个匹配目录生成一个分包，默认 `root` 相对 `outDir` 计算。规则内按路径排序，规则之间保留配置顺序。

开发服务器和 `vite build --watch` 会重新发现目录。启动时目录还不存在、运行中新增、删除、重命名或重建，都会更新 `pages.json`。

`dir` 和 `subPackages` 一律按 glob 解析，字面目录名里的元字符也要转义：

```ts
UniPages({
  dir: 'app\\[prod\\]/src/pages',
})
```

不转义的 `[prod]` 是字符类，会匹配到 `appp` 这类目录名。

## 自定义 root

monorepo 中页面可能在项目根之外，默认 root 会出现 `..`。对象形式可以指定写进 `pages.json` 的 root：

```ts
UniPages({
  subPackages: [
    {
      dir: '../../packages/login/src/pages',
      root: 'packages/login/src/pages',
    },
  ],
})
```

`root` 只决定写进 `pages.json` 的 `subPackages.root`。页面 `path` 仍按文件相对 `outDir` 的实际位置换算，根外目录会得到带 `..` 的路径。`path` 和 `root` 拼起来才是文件相对 `outDir` 的位置，uni-app 靠这个组合定位页面源文件。`root` 本身保持干净。

<Badge type="tip" text="v0.6.0 新增" />

也可以用同步回调按匹配目录计算：

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

对于 `src/packages/account/pages/profile.vue`，回调收到 `src/packages/account/pages`，生成：

```json
{
  "subPackages": [{
    "root": "packages/account",
    "pages": [{ "path": "pages/profile" }]
  }]
}
```

回调的约定：

- 参数始终相对 Vite root，使用 `/` 分隔，没有末尾斜杠
- 返回值必须是非空相对路径，不能是 `.`、绝对路径或包含 `..`
- 每次重新发现目录时都会调用，不能返回 Promise

## 目录与 root 规则

- 同一物理目录同时有固定值和回调结果时，显式 root 优先于默认值；多个显式值相同可以合并，不同则报错
- 多个目录得到同一 root 时统一聚合页面
- 设置 root 不会移动页面文件，只改变 `pages.json` 的写法
- 空目录会被发现，在包含页面之前不会生成空分包
- 目录可以位于 Vite root 之外，路径仍相对 Vite root 解析
- `mergePages: false` 时不扫描也不监听页面目录

`subPackages` 不接受以 `!` 开头的否定规则，排除目录请使用 `exclude`。

## 页面归属

<Badge type="tip" text="v0.6.0 新增" />

多个声明可以指向同一目录，也可以通过符号链接指向同一页面。插件用 realpath 判断目录和页面身份：

- 同一页面归属同一 root 时只保留一份
- 主包和分包同时命中时，有效分包来源优先
- 同一页面被不同 root 认领时报错，错误会列出相关来源和声明
- 同一个目录规则匹配到多个目录并造成跨 root 认领时，错误会说明如何调整声明
- `definePage(null)` 和平台规则跳过的页面不参与归属和路由冲突检查
- 目录声明的显式 root 冲突仍然报错

同一物理目录的多个词法别名都会应用 `exclude`。只有 alias 下的文件被排除时，真实目录下的同一文件仍可贡献页面。

代表来源按以下顺序选择：显式来源优先，其次按声明顺序，glob 内按匹配路径排序。交换声明顺序可能改变代表路径、默认 root 和页面顺序，但不会漏掉有效页面。

## 路由冲突

<Badge type="tip" text="v0.6.0 新增" />

不同生成来源占用同一完整路由时会报错。比较前会规范化 `.`、`..`、分隔符和末尾斜杠。

以下情况允许：

- 同一归属内的 `.vue`、`.nvue`、`.uvue` 格式变体
- 主包内的平台文件名变体

主包的平台后缀规则不会推广到分包，文件族相同也不能掩盖不同分包之间的冲突。

扫描来源冲突在配置覆盖之前检查。`pages.config.ts` 里的同名条目是元数据覆盖，不能用它掩盖冲突。冲突发生时不会把结果写进已有的 `pages.json`。

## 常见配置错误

### 重复扫描父子目录

```ts
UniPages({
  subPackages: ['src/pkg-a', 'src/pkg-a/pages'],
})
```

子目录页面会被两个入口以不同 root 重复认领，插件会报错。整棵目录属于一个分包时，只声明父目录即可。确需多个入口时，让它们使用同一个 root：

```ts
UniPages({
  subPackages: [{ dir: 'src/pkg-a/**', root: 'pkg-a' }],
})
```

### 用 exclude 撤销扫描声明

`exclude` 按词法路径过滤，对所有扫描入口生效。`exclude: ['src/pkg-a/pages']` 也会排除父目录递归扫描到的页面，不能只撤销子目录那条声明。需要保留页面时，应调整扫描声明或统一 root。

## 迁移

0.6.0 起扫描归属统一。从 0.5.x 升级时注意：

- 静态目录共用同一 root 时，以前被后一个目录覆盖的页面会重新出现。不需要这些页面时，删除扫描声明或用 `exclude` 排除
- 同一目录同时配置默认和显式 root 时，改为显式值优先
- 同一物理页面经多个别名生成的多条路由会收敛为一个代表来源，可通过调整来源和声明顺序决定保留的路径
- 跨分包认领或生成路由冲突改为明确报错，需要调整扫描范围、分包归属或 `definePage.path`

## Windows 与监听

Windows 下原生监听会持有子目录句柄，重命名父目录可能报 `EPERM`，见 [Chokidar #1380](https://github.com/paulmillr/chokidar/issues/1380)。需要运行期间重命名时，可以设置：

```shell
CHOKIDAR_USEPOLLING=true
```

这会为页面内容监听和恢复入口启用轮询，`CHOKIDAR_INTERVAL` 可以指定间隔。轮询会增加 CPU 和文件系统访问开销。

Vite 的 `server.watch.ignored` 同样约束 H5 的页面监听，`awaitWriteFinish` 和 `atomic` 会转发给页面内容 watcher。

分包发现会更新 `pages.json`，但不会刷新下游插件在创建时缓存的分包信息。这类插件可能仍需要重启。

## 监听细节

页面监听和符号链接的完整行为见[监听与符号链接](./watchers-and-symlinks.md)。
