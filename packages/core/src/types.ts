import type { PageItem, PagesConfig, SubPackages, TabBarItem } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import type { DefineConditional } from './condition'
import type { debug } from './logger'
import type { Page } from './page'

/**
 * 从对象类型中排除索引签名键，仅保留显式键
 */
export type ExcludeIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K]
}

/**
 * 内部页面元信息
 * 在文档级 PageItem 之上扩展插件内部的 `type` 标记。
 * 插件生成的条目按设计把它保留进 pages.json（供后续运行的首页兜底
 * 使用）；只有跨平台相等性比较会把它归一化掉
 */
export interface InternalPageItem extends PageItem {
  /** 插件用于识别首页的内部标记 */
  type?: 'home' | 'page'
}

export type InternalPages = InternalPageItem[]

/**
 * 用户可在 definePage 宏中定义的 tabBar 项
 * 在文档级 TabBarItem 之上扩展插件专有字段
 */
export interface UserTabBarItem extends Partial<TabBarItem> {
  /**
   * 页面路径，省略时由插件自动填充
   *
   * @deprecated 改用 pages.json 的 pagePath
   */
  pagePath?: string
  /**
   * 插件用于排序 tabBar 项的索引
   *
   * @default 0
   */
  index?: number
  [x: string]: any
}

/**
 * 用户可在 definePage 宏中定义的页面元信息
 * 在文档级 PageItem 之上扩展插件专有字段
 */
export interface UserPageItem extends Partial<PageItem> {
  /**
   * @deprecated 改用 pages.json 的 path
   */
  path?: string
  /**
   * 页面类型，设为 "home" 标记首页
   */
  type?: 'home' | 'page'
  /**
   * tabBar 项配置，插件收集它生成 pages.json 的 tabBar.list
   */
  tabBar?: UserTabBarItem
  [x: string]: any
}

/** 值或值的 Promise */
export type MaybePromise<T> = T | Promise<T>

/** 值或返回该值的函数 */
export type MaybeCallable<T> = T | (() => T)

/** 值、返回该值的函数，或返回该值 Promise 的函数 */
export type MaybePromiseCallable<T> = T | (() => T) | (() => Promise<T>)

/**
 * 注入函数式 definePage 宏的上下文
 */
export interface DefinePageContext {
  /** 当前平台标识，如 'mp-weixin' */
  platform: string
  /**
   * 创建平台条件化的页面元信息定义
   *
   * 用法：`define(base).ifdef(platforms, partial).ifndef(platforms, partial)`。
   * 匹配的分支按声明顺序深合并进 `base`：对象递归合并，数组与原始值
   * 整体替换。`h5` 与 `web` 是同一平台的别名，分支中列出任一个即视为
   * 覆盖两者。
   */
  define: (base: UserPageItem) => DefineConditional
}

/**
 * 在 Vue 页面文件中定义页面元信息
 * 宏调用会在构建时被插件移除
 *
 * 返回 `null`（或直接传 `null`）可将页面从当前平台的 pages.json 中
 * 排除。使用注入的 `define` 工厂编写平台条件化元信息，无需手工按
 * 平台分支。
 */
export declare function definePage(options: UserPageItem | null | ((context: DefinePageContext) => MaybePromise<UserPageItem | DefineConditional | null>)): void

/** definePage 宏的类型 */
export type DefinePage = typeof definePage

/** 调试日志类型，对应 debug 对象中的方法 */
export type DebugType = keyof typeof debug

/**
 * @deprecated 改用 {@link DebugType}
 */
export type debugType = DebugType

/** 配置来源类型，支持字符串路径或 unconfig 的 LoadConfigSource 对象 */
export type ConfigSource = string | LoadConfigSource<PagesConfig> | LoadConfigSource<PagesConfig>[]

/**
 * 插件配置项接口
 * 定义用户可传入的全部配置选项
 *
 * 内部流水线：加载用户配置 -> 扫描页面文件 -> 合并页面元信息 ->
 * 生成并写入 pages.json
 */
export interface Options {

  /**
   * 是否为页面路径生成 TypeScript 声明
   *
   * 为 `true` 时在项目根目录生成 `uni-pages.d.ts`；
   * 为字符串时作为相对项目根目录的自定义输出路径。
   *
   * @default true
   * @since 0.2.9
   */
  dts?: boolean | string
  /**
   * 页面配置文件的加载来源
   *
   * 基于 unconfig，支持合并多个配置来源
   *
   * @default 'pages.config'
   * @since 0.2.7
   */
  configSource: ConfigSource
  /**
   * 默认应用入口页面（首页）
   *
   * 在没有页面通过 `definePage({ type: 'home' })` 标记为首页时使用。
   * 支持多种路径写法，兼容不同的目录布局。
   *
   * @default ['pages/index', 'pages/index/index']
   * @since 0.1.9
   */
  homePage: string | string[]

  /**
   * 是否自动扫描目录并把页面配置合并进 pages.json
   *
   * 关闭时只加载用户配置文件，不扫描文件系统
   *
   * @default true
   * @since 0.1.0
   */
  mergePages: boolean

  /**
   * 主包页面的搜索目录
   *
   * 支持 glob 模式，如 'src/{pages,views}'。
   * 最终结果由 tinyglobby 解析为匹配到的目录列表。
   *
   * @default 'src/pages'
   * @since 0.1.0
   */
  dir: string

  /**
   * uni-app 分包加载的子包页面目录
   *
   * 支持字符串形式（目录路径）或对象形式（pages.json 中的自定义 root）
   *
   * monorepo 项目中页面可能位于项目根目录之外。使用对象形式指定
   * 出现在 pages.json 中的自定义 root，避免生成的 root 路径含 '..'。
   *
   * @see https://github.com/uni-helper/vite-plugin-uni-pages/issues/271
   * @default []
   * @since 0.1.8
   */
  subPackages: (string | SubPackageConfig)[]

  /**
   * pages.json 所在目录
   *
   * 相对项目根目录，也是计算页面相对路径的基准
   *
   * @default 'src'
   * @since 0.0.1
   */
  outDir: string

  /**
   * 排除的文件/目录模式
   *
   * 基于 [tinyglobby 的 ignore 选项](https://superchupu.dev/tinyglobby/documentation#ignore)
   *
   * @default ['node_modules', '.git', '**\/__*__/**']
   * @since 0.0.4
   */
  exclude: string[]

  /**
   * 压缩生成的 pages.json
   * @default false
   * @since 0.1.6
   */
  minify: boolean

  /**
   * 是否在生成的 pages.json 末尾追加换行符
   * @default false
   * @since 0.5.0
   */
  insertFinalNewline: boolean

  /**
   * 生成的 pages.json 的缩进
   *
   * 接受空格数或字符串（如 `'\t'`）
   *
   * `minify` 为 `true` 时忽略
   * @default 2
   * @since 0.5.0
   */
  indent: number | string

  /**
   * 生成的 pages.json 的换行符
   * @default '\n'
   * @since 0.5.0
   */
  eol: '\n' | '\r\n'

  /**
   * 启用调试日志
   *
   * 为 `true` 时启用所有分类；为字符串时只启用对应分类。可用分类：
   * hmr | options | pages | subPages | error | cache | declaration | definePage。
   * 也可通过 DEBUG=vite-plugin-uni-pages:* 环境变量控制。
   *
   * @default false
   * @since 0.1.8
   */
  debug: boolean | DebugType

  /**
   * 生命周期钩子，在各流水线阶段触发。钩子只接收该阶段的输入或输出
   * 数据，绝不接收整个上下文。
   *
   * @since 0.0.3
   */
  onBeforeLoadUserConfig: () => void
  onAfterLoadUserConfig: (pagesGlobConfig: PagesConfig | undefined) => void
  onBeforeScanPages: () => void
  onAfterScanPages: (pages: Map<string, Page>, subPages: Map<string, Map<string, Page>>) => void
  onBeforeMergePageMetaData: (pages: Map<string, Page>, pagesGlobConfig: PagesConfig | undefined) => void
  onAfterMergePageMetaData: (pageMetaData: InternalPages, subPageMetaData: SubPackages) => void
  onBeforeWriteFile: (filePath: string) => void
  onAfterWriteFile: (filePath: string, content: string) => void
}

/** 用户配置项类型，所有选项均为可选 */
export type UserOptions = Partial<Options>

/**
 * 解析后的配置项接口
 * 经 resolveOptions 处理的配置，所有路径均解析为绝对路径
 */
export interface ResolvedOptions extends Omit<Options, 'dir' | 'homePage' | 'configSource' | 'dts' | 'subPackages'> {
  /**
   * 解析为 Vite 配置中的 `root` 值。
   * @default config.root
   */
  root: string

  dts: string | false

  /**
   * 解析后的页面目录列表
   */
  dirs: string[]
  /**
   * 解析后的入口页面
   */
  homePage: string[]

  configSource: LoadConfigSource<PagesConfig>[]

  /**
   * 解析后的子包目录列表
   */
  subPackages: string[]

  /**
   * 子包的自定义 root 映射（目录 -> root）
   * 用于 monorepo 支持，指定 pages.json 中的自定义 root 路径
   */
  subPackageRootMap: Map<string, string>
}

/**
 * 子包配置接口
 * 为 monorepo 支持，允许自定义 pages.json 中的 root 路径
 *
 * monorepo 项目中页面可能位于项目根目录之外（如 ../../packages/login/src/pages）。
 * 默认情况下插件会生成含 '..' 的 root 路径，而 uni-app 不支持。
 * 通过该配置指定出现在 pages.json 中的自定义 root。
 *
 * @example
 * ```ts
 * subPackages: [
 *   {
 *     dir: '../../packages/login/src/pages',  // 实际扫描的物理目录
 *     root: 'packages/login/src/pages',       // pages.json 中的自定义 root
 *   }
 * ]
 * ```
 */
export interface SubPackageConfig {
  /** 扫描页面文件的实际物理目录路径 */
  dir: string
  /** 出现在 pages.json subPackages.root 中的自定义根路径 */
  root: string
}

/**
 * 页面路径信息接口
 * 包含页面文件的相对路径与绝对路径
 */
export interface PagePath {
  /** 相对输出目录的路径 */
  relativePath: string
  /** 页面文件的绝对路径 */
  absolutePath: string
}
