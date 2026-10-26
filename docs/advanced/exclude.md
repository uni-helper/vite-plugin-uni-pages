# 页面排除

<Badge type="tip" text="v0.0.4 新增" />

`exclude` 控制哪些文件不参与页面扫描。规则同时作用于主包、分包、首次扫描和后续的页面事件。

## 基准

<Badge type="warning" text="v0.6.0 变更" />

- 相对模式基于 Vite 的 `root`，不是当前工作目录，也不是扫描目录
- 绝对模式直接匹配对应路径
- 规则命中文件、目录或任一祖先目录时，排除整个子树
- 实际扫描目录、`outDir` 和分包 `root` 都不改变排除基准

默认值：

```ts
exclude: ['**/node_modules/**', '**/.git/**', '**/__*__/**']
```

## 示例

假设 Vite `root` 为 `/workspace/app`：

| `exclude` 项 | 排除范围 |
| --- | --- |
| `index.vue` | `/workspace/app/index.vue` |
| `src/pages/index.vue` | 指定的项目内页面 |
| `**/index.vue` | 项目根子树中各层的同名页面 |
| `src/packages/internal` | 该目录及整个子树 |
| `../shared/pages/**/index.vue` | 根外 `shared/pages` 中各层的同名页面 |
| `/workspace/shared/pages/internal` | 指定的绝对路径及其子树 |

`**` 不跨过前导的 `../`。`**/index.vue` 不会排除 `../shared/pages/index.vue`，根外目录需要显式写出前缀。默认值同样只覆盖项目根子树，需要排除根外的依赖目录时，补充 `../shared/pages/**/node_modules/**` 这类规则。

## 语法

- 传入自定义数组会替换默认值，不是合并
- `exclude: []` 禁用默认页面排除，底层 watcher 的固有忽略仍然生效
- 空字符串会被忽略，路径中的空格会保留
- 不接受 `!foo` 这类否定规则，会直接报错
- `!(keep).vue` 这类 extglob 可以使用

否定规则被禁用是有意为之。排除规则不负责重新包含页面，需要保留的文件应该缩小排除范围。

## 与监听的关系

页面排除控制插件自动发现的页面和变更处理。被排除目录中的配置入口或配置依赖仍会参与配置加载和更新。

事件到达后，插件按当前规则重新判断。能否收到文件系统事件仍受 watcher 后端及其配置限制。Vite 的 `server.watch.ignored` 会叠加在页面监听上，二者都需要允许路径。

`exclude: []` 也会让页面来源出现在 `node_modules` 中时参与扫描。默认值会命中扫描目录本身，因此把页面放在依赖里的来源默认一条也扫不到。需要保留时显式关闭或缩小默认排除：

```ts
exclude: ['**/__*__/**']
```

## 从旧版本迁移

0.6.0 之前，`exclude` 相对每个实际扫描目录解释。统一到 Vite root 后，旧规则需要补上扫描来源的前缀。

例如扫描 `src/pages`、`src/packages/*/pages` 和 `../shared/pages` 时，旧的 `exclude: ['index.vue']` 应改成：

```ts
exclude: [
  'src/pages/index.vue',
  'src/packages/*/pages/index.vue',
  '../shared/pages/index.vue',
]
```

这保留了只排除各扫描目录第一层 `index.vue` 的范围。直接改成 `**/index.vue` 会额外排除嵌套的同名页面，也不能覆盖根外来源。

| 原写法 | 等价迁移 |
| --- | --- |
| `internal/**` | 分别写 `src/pages/internal/**`、`src/packages/*/pages/internal/**`、`../shared/pages/internal/**` |
| `**/components/**` | 项目内保留原写法，根外补 `../shared/pages/**/components/**` |
| `node_modules` | 分别写 `src/pages/node_modules`、`src/packages/*/pages/node_modules`、`../shared/pages/node_modules` |

默认值也从按目录名匹配改为项目根子树中的目录模式，扩大了项目内的默认排除范围。目录排除现在对所有扫描形式生效，静态分包也会排除命中的目录。

## 相关

- [分包](./subpackages.md)
- [监听与符号链接](./watchers-and-symlinks.md)
