import type { PageItem, PagesConfig, SubPackages, TabBarItem } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import type { Plugin } from 'vite'
import type { DefineConditional } from './condition'
import type { debug } from './logger'
import type { Page } from './page'

/** 提前生成页面配置所需的运行环境 */
export interface PrepareOptions {
  /**
   * Vite 项目根目录，相对路径以当前工作目录为基准
   *
   * @default process.env.VITE_ROOT_DIR || process.cwd()
   */
  root?: string
  /** 是否采用 UniPlatform 文件名后缀规则，必须与最终插件列表一致 */
  platformSuffix: boolean
}

/**
 * 支持提前生成页面配置的 Vite 插件实例
 *
 * @description 同一实例可在构建或开发服务器关闭后顺序复用；重叠运行的构建和服务器须各自创建实例
 */
export interface UniPagesPlugin extends Plugin {
  /**
   * 等待页面配置与已启用的声明文件生成，返回当前插件实例
   *
   * @description
   * - 在创建需要读取 pages.json 的下游插件之前等待此方法完成
   * - 使用调用时的 UNI_PLATFORM；根目录、平台和后缀规则必须与 Vite 初始化一致
   * - 当前准备期间相同参数的并发或重复调用共享结果，首次 Vite 接管复用该结果
   * - Vite 会话关闭后再次调用会重新生成；成功准备过的根目录、平台和后缀约束持续有效
   * - 生成失败后可重试
   *
   * @throws 参数冲突、编译平台缺失、实例正在关闭或生成失败时拒绝 Promise
   */
  prepare: (options: PrepareOptions) => Promise<UniPagesPlugin>
}

/**
 * 从对象类型中排除索引签名键，仅保留显式键
 */
export type ExcludeIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K]
}

/**
 * 插件内部的页面信息
 * 在标准 PageItem 之上加了插件自己用的 `type` 标记。
 * 插件写的条目会带着它进 pages.json（之后的运行靠它找回首页）；
 * 只有比较两个条目相不相等时，会先把它去掉再比
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
 * 用户可在 definePage 宏中定义的页面配置
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
   * 开始写"按平台不同"的页面配置
   *
   * 用法：`define(base).ifdef(platforms, partial).ifndef(platforms, partial)`。
   * 匹配的分支按写的顺序合并进 `base`：对象一层层合并，数组和普通值
   * 整个替换。`h5` 和 `web` 是同一个平台的两个名字，写哪个都算
   * 两个都匹配。
   */
  define: (base: UserPageItem) => DefineConditional
}

/**
 * 在 Vue 页面文件中定义页面配置
 * 宏调用会在构建时被插件移除
 *
 * 返回 `null`（或直接传 `null`）可把页面从当前平台的 pages.json 里
 * 排除。用传进来的 `define` 就能按平台写不同配置，不用自己判断平台。
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
 * 内部流水线：加载用户配置 -> 扫描页面文件 -> 合并页面配置 ->
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
   * @description 基于 unconfig，按来源顺序加载首个有效配置
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
   * @description
   * 支持字符串或对象形式的目录 glob，开发期间自动发现新增、删除和重命名的目录
   * 对象的 root 可用同步回调根据匹配目录计算
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
   * 页面排除的文件或目录模式
   *
   * @description
   * - 相对模式基于 Vite root，绝对模式直接匹配对应路径；命中目录时排除整个子树
   * - 主包、分包的扫描与页面事件使用相同规则
   * - 自定义数组替换默认值，空数组禁用默认页面排除，空字符串忽略
   * - 不接受 `!foo` 否定规则，`!(keep).vue` 等 extglob 有效
   *
   * @default ['**\/node_modules/**', '**\/.git/**', '**\/__*__/**']
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
 * 保留原始扫描规则、展开后的目录和生成选项
 */
export interface ResolvedOptions extends Omit<Options, 'homePage' | 'configSource' | 'dts' | 'subPackages'> {
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

  /** 原始子包目录规则，用于重新发现目录 */
  subPackagePatterns: (string | SubPackageConfig)[]

  /**
   * 子包目录的 root 映射（目录 -> 最终 root）
   *
   * @description 未登记的目录继续使用相对 outDir 的默认 root
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
  /** 扫描页面文件的物理目录或 glob，相对 Vite root 解析 */
  dir: string
  /**
   * 出现在 pages.json subPackages.root 中的自定义根路径
   *
   * @description
   * 回调同步接收相对 Vite root、使用 `/` 分隔且无末尾斜杠的匹配目录
   * 返回值须为非空相对路径，不能包含 `..`；每次重新发现目录时会再次调用
   */
  root: string | ((dir: string) => string)
}

/** 最终分包 root 的决议来源 */
export interface ScanSourceOrigin {
  /** 提供 root 的词法目录，与对应分包目录来源的 dir 一致 */
  dir: string
  /** 提供 root 的声明在 subPackagePatterns 中的索引，从 0 开始 */
  ruleIndex: number
  /** 提供 root 的声明是否为显式来源 */
  explicitRoot: boolean
}

/** 扫描来源的词法目录及声明位置 */
export interface ScanSourceCoordinate {
  /** 扫描目录的词法路径，保留符号链接别名；相对路径以 Vite root 为基准 */
  dir: string
  /** 当前声明是否显式提供 root，与是否继承其他声明的显式 root 无关 */
  explicitRoot: boolean
  /** 主包为 0，分包为 subPackagePatterns 中的从零索引；hook 页面未关联声明时为 -1 */
  ruleIndex: number
  /** 声明内从零开始的目录匹配索引；glob 按路径排序，无匹配记录时为 0 */
  matchIndex: number
  /** 最终分包 root 的决议来源，可能来自另一声明；主包及未关联声明的 hook 页面无此值 */
  rootSource?: ScanSourceOrigin
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
