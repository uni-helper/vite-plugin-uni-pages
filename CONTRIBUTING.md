# 贡献指南

感谢你对 vite-plugin-uni-pages 的关注。本文档介绍如何在本地搭建开发环境、运行测试与调试。

## 前置条件

- [Node.js](https://nodejs.org/) 24（见仓库根目录 `.nvmrc` / `.node-version`）
- [pnpm](https://pnpm.io/) 10.34.4（由 `package.json` 的 `packageManager` 字段锁定，建议配合 Corepack 使用）

## 常用命令

所有命令均在 monorepo 根目录执行：

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 仅构建 core 包
pnpm -C packages/core build

# 运行测试
pnpm test

# 测试覆盖率
pnpm coverage

# 代码检查
pnpm lint

# 类型检查
pnpm type-check

# 启动 playground 调试
pnpm play:mp-weixin
pnpm play:web
```

## 测试

测试文件位于 monorepo 根目录的 `test/` 目录下，使用 [Vitest](https://vitest.dev/) 运行：

```shell
test/
├── generate-routes-*.test.ts            各平台（web / mp-weixin / mp-alipay）路由生成
├── generate-tabbar-web.test.ts          tabBar 生成
├── define-page-*.test.ts                definePage 宏：条件 DSL、null、平台行为
├── concurrent-pages-json.test.ts        多终端并发读写 pages.json
├── files*.test.ts                       文件工具与文件锁
├── pages-json-*.test.ts                 pages.json 生成细节（空行、首页排序、子包收敛、纯合并 seam）
├── repro-dup.test.ts                    重复路由回归
└── types.test.ts                        类型断言
```

平台相关的快照测试通过 seam 注入 `platform`，并用 `vi.mock` / `vi.stubEnv` 隔离环境变量与文件系统，保证不同环境下结果确定。

## 项目结构

```shell
vite-plugin-uni-pages/
├── packages/
│   ├── core/           插件核心逻辑
│   ├── types/          pages.json TypeScript 类型定义
│   └── schema/         JSON Schema（从 types 自动生成）
├── test/               测试文件
├── playground/         示例 uni-app 项目
└── pnpm-workspace.yaml
```

core 包的内部架构（模块划分、依赖关系、生命周期与关键设计决策）见 [packages/core/README.md 的「架构」章节](./packages/core/README.md#架构)。
