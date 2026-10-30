# 配置依赖热更新

<Badge type="tip" text="v0.6.0 新增" />

`pages.config.ts` 可以导入本地模块。开发服务器和 `vite build --watch` 会监听配置入口及其依赖，修改后重新生成 `pages.json` 和类型声明。

## 基本用法

```ts
// pages.config.ts
import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'
import { globalStyle } from './config/global-style'

export default defineUniPages({ globalStyle })
```

```ts
// config/global-style.ts
export const globalStyle = {
  navigationBarTitleText: '首页',
}
```

修改 `global-style.ts` 会触发重新生成，不需要重启。

## 支持范围

- 本地 TypeScript、JavaScript 和 JSON
- 省略扩展名的导入，包括 `.mjs`、`.cjs`，以及指向目录的导入
- 静态 `import`、`export ... from`
- 字面量的 `import()` 和 `require()`
- workspace 包中真实路径位于 `node_modules` 之外的源码，包括 Vite root 之外的文件
- 已安装包的 TypeScript、JSON 入口及其相对依赖，它们可以正常加载，但位于 `node_modules` 内的文件不参与自动监听

新增导入后会更新监听集合。导入目录时，该目录的 `package.json` 也会参与监听，修改 `main` 或 `exports` 后按新入口重新加载。移除导入后，该文件不再触发配置生成。纯类型导入不参与运行时依赖监听。

如果新增的依赖在加载期间被修改，生成结束时会再跑一轮，用最新内容重新生成。这一轮不会重复排队。

以下内容不在自动监听范围内：

- `node_modules` 内的普通 JavaScript 包，它们按 `import` 和 `require` 的条件导出解析
- 通过变量加载、没有被打包器展开的动态目标
- `fs.readFile()` 等自行读取的文件
- 应用的 `resolve.alias`
- Node 自定义 loader、`--conditions` 等额外命令行解析选项

## 错误恢复

- 配置或依赖出现语法错误、缺失文件时，watch 模式保留上次成功生成的产物并报告错误，修复后继续更新
- JSON 配置带 UTF-8 BOM 时按普通 JSON 解析
- 已加载的配置入口被删除后使用空配置，重建入口后恢复加载
- 首次加载失败会终止初始化，修复后重新运行即可

## 运行时加载

配置辅助模块可以在运行时加载其他文件：

```text
app/
├── pages.config.ts
└── config/
    ├── global-style.ts
    └── title.mjs
```

```ts
// config/global-style.ts
const target = './title.mjs'
const { title } = await import(target)

export const globalStyle = { navigationBarTitleText: title }
```

加载关系是 `pages.config.ts → config/global-style.ts → config/title.mjs`。最后一步是运行时解析，相对路径以发起调用的 `global-style.ts` 为基准，读取的是 `app/config/title.mjs`。

导入写法决定依赖如何加载和更新：

| 写法 | 行为 |
| --- | --- |
| `import { title } from './title.mjs'`、`import('./title.mjs')`、`require('./title.cjs')` | 路径明确，由打包器收集，本地文件参与监听并重新求值 |
| 可枚举的相对表达式，例如 ``import(`./titles/${locale}.mjs`)`` | 由打包器展开候选文件，收集到的本地文件参与监听；一个候选文件都不存在时打包失败、配置不生效，创建文件后需要修改配置入口或重启才能恢复 |
| 未展开的 `import(target)`、`require(target)` | 按调用模块的源位置交给 Node 加载，沿用 Node 缓存，动态目标不自动加入监听集合 |

同一张表也写在 [packages/core/README.md](https://github.com/uni-helper/vite-plugin-uni-pages/blob/main/packages/core/README.md)，两处一起维护。

`title.mjs` 属于最后一种情况。只修改它不会触发配置更新，重新加载入口也可能继续读到缓存值。需要热更新时，改成静态导入。

对配置入口和打包进配置的脚本模块，以下值都指向各自的源文件：

- `__dirname`
- `__filename`
- `import.meta.url`
- `import.meta.dirname`
- `import.meta.filename`

`require.resolve()` 和 `import.meta.resolve()` 从调用模块的位置解析，只返回路径或 URL，不加载目标。由 Node 在运行时加载的目标不经过这层转换，遵循目标模块自身的 ESM 或 CommonJS 语义。

`import.meta.env` 和 app 代码里那份是同一套值：Vite 解析完配置后交给插件的 `config.env`，也就是 `.env` 文件里 `VITE_` 开头的变量，加上 `BASE_URL`、`MODE`、`DEV`、`PROD`，再加一个 `SSR: false`。所有模块拿到的是同一个对象，`Object.keys(import.meta.env)` 可以直接用。`process.env` 里同名的前缀变量优先于 `.env` 文件，这条也和 Vite 一致。

`prepare()` 在 Vite 解析配置之前运行，那时还没有 `config.env`，只能用进程环境兜底：`VITE_` 开头的变量加同样四个标准键。值写在 `.env` 文件里的项目，`prepare()` 生成的结果会和 Vite 会话里的不一样，需要一致就等 Vite 开始构建。

其余成员不由插件提供，读到的就是 Node 里的 `undefined`。共享工具文件里常见的 `typeof import.meta.glob === 'function'` 会走 false 分支，`import.meta.hot` 是 `undefined`。碰到这类访问时插件会给出带文件位置的警告，说明生成 `pages.json` 时读不到它：

```text
[vite-plugin-uni-pages] src/utils/common.ts:3:7 reads import.meta.glob, which is not available while the pages config runs. Read environment values from process.env, and move other Vite-only access out of the config's import graph.
```

把 `import.meta` 整体当值用同样不安全：`const meta = import.meta` 拿到的 `url` 属于临时产物，不是源文件。需要这些值就逐个成员访问。

## 自定义 transform 和 parser

```ts
UniPages({
  configSource: {
    files: 'pages.config',
    transform: (code, id) => code.replace('__TITLE__', '首页'),
    parser: filepath => loadMyConfig(filepath),
  },
})
```

对实际加载的入口，回调按 `transform → parser → rewrite` 的顺序执行。成功加载时各调用一次，前一步失败会终止后续回调。

| parser | 读取内容 | 依赖跟踪 |
| --- | --- | --- |
| 内置 `auto`、`json`、`import` | 使用内存中的 transform 结果，未返回有效字符串时使用原内容 | 脚本打包收集到的本地输入 |
| 自定义函数 | 收到原入口路径，自行读取文件；transform 会执行，但返回文本不传给 parser | parser 自行读取的文件不自动加入依赖集合 |

transform 在内存中完成，不会写回配置文件或相邻文件。

## 临时产物

脚本执行需要的文件放在 `node_modules/.cache/uni-pages/` 的独占子目录中：

```text
node_modules/.cache/uni-pages/
└── load-<随机后缀>/
    ├── runtime.mjs
    └── config.mjs
```

每次加载结束后都会尝试清理。清理失败不会改变这次的结果，也不会覆盖原始错误；残留目录不会被当作配置输入，可以安全删除。这个目录专供加载器使用，不要放项目配置。

源码转换不修改项目文件，独占目录让并发加载的产物互不覆盖。

每次重新加载都会执行一份新的 ESM 模块，Node 不会卸载之前执行的模块。频繁修改配置时，旧模块会留在内存中，这是配置可以反复求值的代价。

## 加载流程

配置文件由 `unconfig` 发现，再由 `bundle-require` 和 esbuild 打包执行：

1. 在缓存目录创建独占的 `load-*` 子目录，写入公共辅助模块 `runtime.mjs`
2. esbuild 解析入口和静态依赖，省略扩展名时按 esbuild 的后缀顺序查找，目录导入读取 `package.json`，同时记录缺失导入的恢复候选
3. 转换每个模块，注入绑定原文件位置的 `require`、`import.meta` 成员和动态导入函数，`import.meta.env` 指向本轮的公共 env 对象，同时扫出读不到的 `import.meta` 成员
4. 打包成 `config.mjs` 后由 Node 执行，加载器取出配置对象并记录本地依赖
5. 成功或失败都尝试删除本轮 `load-*` 目录

加载失败时会保留尝试过的路径和缺失导入候选，后续文件事件可以触发重试。

## 配置入口的位置

`configSource` 的 `files` 相对 Vite root 解析。配置文件可以在子目录里，依赖按导入它的模块位置解析。

```ts
UniPages({
  configSource: {
    files: 'config/pages',
  },
})
```

## 下一步

- [监听与符号链接](./watchers-and-symlinks.md)
- [会话与实例复用](./lifecycle.md)
