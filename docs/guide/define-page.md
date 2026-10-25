# definePage

`definePage` 是页面级配置宏。插件在扫描时读取它，在转换时把调用从产物里删掉，所以不会影响运行时。

## 基本写法

在 `<script setup>` 或 `<script>` 的顶层调用：

```vue
<script setup lang="ts">
definePage({
  type: 'home',
  style: {
    navigationBarTitleText: '首页',
  },
})
</script>
```

可用的字段和 `pages.json` 的页面条目一致，另外支持：

| 字段 | 说明 |
| --- | --- |
| `type` | `'home'` 标记首页，`'page'` 为普通页面 |
| `tabBar` | 生成 `tabBar.list` 条目 |
| `path` | 覆盖页面路径，不常用 |
| `style` | 页面样式 |

## tabBar 条目

```vue
<script setup lang="ts">
definePage({
  tabBar: {
    text: '首页',
    iconPath: 'static/home.png',
    selectedIconPath: 'static/home-active.png',
  },
})
</script>
```

`pagePath` 不写时使用页面自己的路径。`index` 控制多个 `definePage` 条目之间的先后顺序，不会写进 `pages.json`。

`pages.config.ts` 里也有 `tabBar.list` 时，两边按 `pagePath` 合并，配置里的条目优先，缺的条目补在后面。

## 按平台跳过页面

直接传 `null`，或者从函数里返回 `null`，页面就不会出现在当前平台的 `pages.json` 里：

```vue
<script setup lang="ts">
definePage(({ platform }) => {
  if (platform === 'h5')
    return null

  return { style: { navigationBarTitleText: '仅小程序' } }
})
</script>
```

跳过的页面不参与页面归属和路由冲突检查。

## 函数式写法

函数参数提供当前平台和一个条件定义工具：

```vue
<script setup lang="ts">
definePage(({ define }) =>
  define({
    style: { navigationBarTitleText: '标题' },
  })
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    .ifndef(['h5', 'web'], { middlewares: ['auth'] }),
)
</script>
```

`define(base)` 返回一个可链式调用的对象：

- `.ifdef(platforms, partial)`：只在列出的平台合并 `partial`
- `.ifndef(platforms, partial)`：在列出的平台之外合并 `partial`
- 分支按声明顺序合并，对象递归合并，数组和普通值直接替换
- `h5` 和 `web` 视为同一个平台，写任意一个都同时匹配
- 条件在扫描阶段按当前平台算成普通对象，不会写进 `pages.json`

函数可以是 `async`。返回值可以是页面配置对象、`define()` 的结果，或者 `null`。

## 引用导入的值

宏参数里可以用页面文件导入的值：

```vue
<script setup lang="ts">
import { TITLE } from './title.mjs'

definePage({
  style: { navigationBarTitleText: TITLE },
})
</script>
```

插件会收集宏参数引用到的 import 一起执行。没有被引用到的 import（例如组件）不会加载。

普通 `<script>` 块里的 import 也能用。两个 script 块中的同名 import 只保留一份。

相对导入需要写全扩展名，例如 `./title.mjs`、`./title.ts`。省略扩展名的 `./title` 在宏求值时无法解析，因为求值走 Node 的 `require` 语义，不做 TypeScript 的扩展名补全。

## 限制

- `definePage` 必须写在 script 块的顶层，不要包进 `if`、`try` 等语句块。包在里面的调用读不到配置，也不会被移除，运行时会报 `definePage is not defined`
- 参数只支持对象字面量、函数表达式、箭头函数和 `null`。其他表达式不会被识别
- 页面文件如果解析失败，插件会输出警告并退回默认页面配置。使用 `@babel/parser` v8 后，已废弃的 `assert { ... }` import attributes 不再支持，需要改成 `with { ... }`
- 不支持 JSX/TSX 页面文件

## 类型提示

编辑器和 `tsc` 需要知道 `definePage` 是全局宏。引用 `/client` 类型即可：

```ts
// env.d.ts
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />
```
