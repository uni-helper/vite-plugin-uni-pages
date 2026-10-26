# prepare()

<Badge type="tip" text="v0.6.0 新增" />

`prepare()` 在 Vite 启动前完成一次完整生成，供需要在工厂函数阶段读取 `pages.json` 的下游插件使用。

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

数组按顺序求值。`Optimization()` 会等到 `prepare()` 完成后再执行，此时 `pages.json` 和类型声明已经写好。

也可以分步调用：

```ts
const pages = UniPages(options)
await pages.prepare({ platformSuffix: false })
```

`prepare()` 返回同一个插件实例，之后可以直接放进 `plugins`。

## 参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `root` | `string` | Vite 项目根目录。相对路径以当前工作目录为基准，默认 `VITE_ROOT_DIR` 或 `process.cwd()` |
| `platformSuffix` | `boolean` | 必填。是否启用 UniPlatform 文件名后缀规则，必须和最终插件列表一致 |

`platformSuffix` 对应 `@uni-helper/vite-plugin-uni-platform` 是否启用。实际是否启用由 Vite 的插件列表判断，`prepare()` 不会读取插件列表，所以必须显式声明。

## 运行环境

- 编译平台读取调用时的 `process.env.UNI_PLATFORM`。独立脚本需要提前设置
- 准备阶段 Vite 还没有加载 `.env`。配置依赖其中的变量时，先用 `loadEnv()` 加载
- 自定义 Vite `root` 时，向 `prepare()` 传入相同的根目录

## 行为

- 同一次准备期间，根目录、平台和后缀规则相同的并发或重复调用只初始化一次
- Vite 启动后会复用这份上下文，并核对根目录、平台和后缀规则，不一致时报错
- 成功调用过后，这组参数约束会一直有效，包括先启动 Vite、后调用 `prepare()` 的情况
- 配置加载、文件写入或锁获取失败会拒绝 Promise，修复后可以再次调用
- Vite 会话关闭后再次调用会重新读取配置和页面

准备完成到文件监听建立之间的修改不保证被发现。需要确保最新内容时，等 Vite 启动后再修改一次，或重新运行命令。

## 限制

- 不会刷新下游插件已经缓存的配置。需要完整配置的插件应该在 `prepare()` 完成后创建
- 如果 Vite 在创建 Rollup 构建图或开发服务器之前就退出，插件收不到关闭通知，这个实例会保持占用。这种情况下换一个新的 `UniPages()` 实例
- `build --watch` 期间实例一直属于当前会话，整个 watcher 关闭后才释放。重复使用和关闭的细节见[会话与实例复用](../advanced/lifecycle.md)

## 普通用法

不调用 `prepare()` 时，插件仍然按同步方式创建。能推导出的输出目录存在时，工厂会先为缺失的 `pages.json` 创建占位文件，等 Vite 初始化后再完整生成。

推导目录不存在时不会创建占位文件，也不会在错误的位置新建目录。此时直接跑完整生成，根目录不对时会以 `ENOENT` 失败。
