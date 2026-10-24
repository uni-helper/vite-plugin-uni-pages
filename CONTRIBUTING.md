# 贡献指南

感谢你对 vite-plugin-uni-pages 的关注。本文档介绍如何在本地搭建开发环境、运行测试与调试。

## 前置条件

- [Node.js](https://nodejs.org/) 24（见仓库根目录 `.nvmrc` / `.node-version`）
- [pnpm](https://pnpm.io/) 12.14.0（由 `package.json` 的 `packageManager` 字段锁定，建议配合 Corepack 使用）

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
pnpm typecheck

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
├── macro-*.test.ts                      宏解析：单个 script 块失败隔离、跨块导入
├── page-macro-failure-warn.test.ts      宏求值失败只告警不中断
├── page-uri-dot-directory.test.ts       页面 path 只在末尾去扩展名
├── platform-suffix-*.test.ts            平台后缀页面的筛选与优先级
├── platform-variants.test.ts            平台变体表的合并与排序规则
├── uni-platform-dots.test.ts            文件名中的点只有后缀位才算平台后缀
├── pages-json-*.test.ts                 pages.json 生成细节（空行、首页排序与平台、
│                                        纯合并 seam、子包收敛、tabBar 按平台、EPERM 重试）
├── pages-json-entry-order.test.ts       tabBar list 条目顺序（新增落位、全量重排、pages 不重排）
├── subpackage-glob.test.ts              分包 glob、root 映射与冲突检查
├── subpackage-glob-watcher.test.ts      目录监听边界与 watch 就绪
├── subpackage-root-sources.test.ts      默认与显式 root 决议、别名来源及冲突信息
├── scan-ownership.test.ts               目录 root 决议、页面身份归属与生成路由冲突
├── scan-ownership-output.test.ts        聚合配置元数据与 pages.json、虚拟模块、声明一致性
├── page-exclude.test.ts                 页面排除基准、模式语义与目录发现一致性
├── page-exclude-watch.test.ts           页面排除与配置依赖在真实 watcher 下的隔离
├── page-content-refresh.test.ts         页面删建、ready 补扫与增量读取缓存
├── page-update-coalescing.test.ts       连续 watcher 事件的合并与读取上界
├── page-symlink-*.test.ts               符号链接事件映射、嵌套/外部目标恢复与真实 watcher
├── page-source-watch.test.ts            来源关系、交叉/循环链接、权限失败、启动重试、物理订阅去重与非递归恢复入口
├── page-watch-sources.test.ts           链接目标真实路径、权限/竞态降级、Unicode 与别名膨胀上限
├── page-watch-options.test.ts           Vite 监听开关、轮询/写稳定性选项与忽略规则
├── page-watch-ownership.test.ts         页面文件事件单一处理、原子替换与外部/依赖别名的监听覆盖
├── page-watch-filter.test.ts            Vite 忽略规则的词法路径、相对与否定模式匹配
├── subpackage-user-pages-path.test.ts   配置里的分包 pages 按 root 写相对 path
├── concurrent-pages-json.test.ts        多终端并发读写 pages.json
├── files*.test.ts                       文件工具与文件锁
├── config-dependencies.test.ts          配置本地依赖加载与 unconfig 回调兼容
├── config-source.test.ts                每模块源位置、根外 workspace、动态缓存边界与 transform 隔离
├── config-source-cleanup.test.ts        加载目录清理失败不改变结果或原始错误，残留产物仍隔离
├── config-dependencies-watch.test.ts    dev/build 单次修改、依赖切换、连续失败与恢复
├── config-artifact-watch.test.ts        真实输入与专用产物目录的身份、监听过滤
├── config-recovery-watch.test.ts        连续失败恢复范围的确定性事件回归
├── config-watch-fast-path.test.ts       配置 watcher 路径匹配开销
├── watcher-config-path.test.ts          watcher 归一化配置变更路径
├── watcher-dir-boundary.test.ts         页面文件只在配置目录内匹配
├── watcher-update-failure.test.ts       监听更新失败只记日志不抛出
├── declaration-*.test.ts                声明生成：tab 页过滤与失败后的通知
├── prepare.test.ts                      pages.prepare()
├── repro-dup.test.ts                    重复路由回归
└── types.test.ts                        类型断言
```

平台相关的快照测试通过 seam 注入 `platform`，并用 `vi.mock` / `vi.stubEnv` 隔离环境变量与文件系统，保证不同环境下结果确定。

### 配置加载与监听

源位置用例应建立完整的调用链：配置入口静态导入辅助模块，辅助模块再执行待测的相对加载。入口和辅助模块可各自加载同名、不同内容的目标文件，以确认每个调用使用自己的源位置。静态依赖与运行时动态目标分别验证加载、缓存、监听和失败恢复行为。

真实 watcher 用例应先确认目标路径已注册，再在目标父目录中用独立哨兵文件确认事件可达，之后只修改一次待测文件。分别断言文件系统事件已收到、产物已更新、待处理队列已收敛。事件超时输出诊断并失败，避免额外修改待测文件掩盖订阅遗漏。

清理失败属于环境异常，用例应断言加载结果和原始错误都不被清理错误替换，并确认残留的 `load-*` 目录仍被输入索引和监听排除。成功路径的测试继续以父目录为空作为常规验收条件。

源码到临时执行文件的数据流见[脚本配置的加载流程](./packages/core/README.md#脚本配置的加载流程)。

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
