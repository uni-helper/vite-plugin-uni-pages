# 会话与实例复用

一个 `UniPages()` 实例在同一时间只服务一个 Vite 会话。会话结束后可以顺序复用，重新读取配置和页面。

## 顺序复用

普通 `build()` 完成、开发服务器 `server.close()` 完成，或者构建监听器 `watcher.close()` 完成后，下一次使用会创建新的页面上下文：

```ts
import { writeFile } from 'node:fs/promises'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { build } from 'vite'

const pages = UniPages()
const config = { plugins: [pages] }

await build(config)
await writeFile('src/pages/detail.vue', '<template><view>详情</view></template>')
await build(config) // 包含新增的 detail 页面
```

新会话会重新生成 `pages.json`、虚拟模块和已启用的声明文件。

没有成功调用过 `prepare()` 的实例，在会话结束后可以更换 `root`、`UNI_PLATFORM` 或后缀规则。成功调用过 `prepare()` 后，这组参数约束会一直有效。

## 同时只能有一个会话

从 `configResolved` 开始初始化，到会话关闭完成，实例只接受一个 Vite 会话。

以下用法会报错：

- 开发服务器还开着，又用同一实例启动构建
- 构建还没结束，又启动另一个构建
- 整个 `build --watch` 期间再次用同一实例启动 Vite
- `server.restart()` 复用同一实例，因为新服务器会在旧服务器关闭前创建

嵌套构建、并行任务和重启场景应分别调用 `UniPages()` 创建实例。

## 关闭时发生什么

- 立即停止接受监听注册和新更新
- 取消尚未开始的更新
- 等待已经开始的生成和资源释放完成
- 释放失败只记录错误，不替换构建结果或初始化错误
- 初始化失败后可以修复输入并重新使用实例

已关闭 watcher 的旧构建如果还有钩子继续执行，虚拟模块读取会拒绝，清理也不会影响新会话。

## 构建监听

`build --watch` 每轮构建结束时仍保留当前会话和监听，直到整个 watcher 关闭。每轮构建复用同一份上下文。

通过 Vite JavaScript API 使用构建监听时，应在首轮构建已经启动后再关闭 watcher，例如等待首个 `END` 事件：

```ts
const watcher = await build({ ...config, build: { watch: {} } })

await new Promise((resolve, reject) => {
  const onEvent = (event) => {
    if (event.code === 'END' || event.code === 'ERROR') {
      watcher.off('event', onEvent)
      event.code === 'END' ? resolve() : reject(event.error)
    }
  }
  watcher.on('event', onEvent)
})

await watcher.close()
```

Rollup 在首个构建图创建前立即关闭时，可能不调用 `closeWatcher`。插件收不到释放通知，这种提前关闭不保证释放资源，也不能作为顺序复用的信号。

## 收不到关闭通知的情况

以下场景插件无法释放实例：

- Vite 在创建 Rollup 构建图或开发服务器之前就退出，例如其他插件的 `configResolved` 或 `options` 抛错
- 只调用了 `resolveConfig()`，没有真正启动构建或服务器
- 程序化调用 `server.restart()`，新旧服务器重叠

这些情况应创建新的 `UniPages()` 实例，不要把旧实例交给下一次构建。

## 相关

- [prepare()](../api/prepare.md)
- [配置依赖热更新](./config-dependencies.md)
