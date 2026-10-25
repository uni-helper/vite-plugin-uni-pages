# 构建与兼容性

## 包

仓库包含三个发布包：

| 包名 | 作用 |
| --- | --- |
| `@uni-helper/vite-plugin-uni-pages` | Vite 插件本体 |
| `@uni-helper/uni-pages-types` | `pages.json` 的 TypeScript 类型 |
| `@uni-helper/pages-json-schema` | `pages.json` 的 JSON Schema |

`vite-plugin-uni-pages` 依赖 `uni-pages-types`，schema 由 types 自动生成。

## 运行环境

### Node.js

插件要求：

```text
^22.22.2 || ^24.15.0 || >=26.0.0
```

构建产物目标为 Node 22.22.2。配置文件由 esbuild 打包后交给 Node 执行，因此配置里可以使用 TypeScript 语法，不需要额外的运行时转译器。

### Vite

`vite` 是 peer 依赖，要求 `^5.0.0`。uni-app 官方插件当前基于 Vite 5。

### 模块格式

插件仅提供 ESM 入口：

```json
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      }
    }
  }
}
```

CommonJS 项目需要迁移到 ESM，例如把 Vite 配置改名为 `vite.config.mts`。

## 发布内容

插件包的 `files` 包含：

```text
client.d.ts
dist
global.d.ts
```

`/client` 子路径提供 `definePage` 全局宏和 `virtual:uni-pages` 的类型声明，不包含运行时代码。

## 构建

仓库使用 pnpm 和 tsdown：

```shell
pnpm install
pnpm build
```

`pnpm build` 会依次构建 `packages/*`，其中包括重新生成 schema。修改 `packages/types` 后应重新构建并提交 `packages/schema/schema.json`，否则发布产物会和类型定义不一致。

## 测试与检查

```shell
pnpm test
pnpm coverage
pnpm lint
pnpm typecheck
```

CI 在 Linux、macOS 和 Windows 上使用 Node 22、24、26 运行构建、检查、测试和类型检查。

## 文档站

文档使用 VitePress：

```shell
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

构建产物在 `docs/.vitepress/dist`，可以部署到任意静态托管服务。

## 页面文件

页面只支持 `.vue`、`.nvue`、`.uvue`。JSX/TSX 不在支持范围内。

## 浏览器兼容性

插件只运行在构建期的 Node 进程里，不会进入业务代码，也不需要浏览器 polyfill。生成的 `pages.json` 是普通 JSON，由 uni-app 编译流程处理。
