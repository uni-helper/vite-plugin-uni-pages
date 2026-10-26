import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { CommentObject, CommentSymbol } from 'comment-json'
import type { InternalPages } from './types'
import fs from 'node:fs'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import writeFileAtomic from 'write-file-atomic'
import { withFileLock } from './files'
import { debug } from './logger'
import { mergePlatformItems } from './pages-json-items'
import { ensureHomePageFirst, removeStaleSubPackages } from './pages-json-structure'
import { lineComment } from './pages-json-tokens'
import { hasGenerationMarker } from './platform-variants'
import { mergeTabBarProps, renderTabBarListLines, renderTabBarPropLines } from './tab-bar'

/**
 * pages.json 的读取、合并、写回
 *
 * 这个文件负责 pages.json 的主流程：
 * - 多个平台共用一个文件时，用 #ifdef 注释区分各自的条目（合并规则
 *   的核心在 platform-variants.ts，数组侧的适配在这里，对象侧
 *   tabBar 属性的适配在 tab-bar.ts）
 * - tabBar list 的条目顺序：配置覆盖全部既有条目时按配置顺序输出，
 *   否则新增条目落到声明位置、既有条目保持磁盘序（规则 6）
 * - 合并时保持首页排最前
 * - 写入"由插件生成"的标记，靠它识别哪些条目是插件写的
 * - 序列化格式（缩进、换行）
 * - 文件锁和原子写入，防止并发写坏文件
 *
 * 外部只需要用 writePagesJson（写文件）和 mergePagesJson（纯计算），
 * 不用接触 comment-json 的内部结构。
 *
 * 当前平台用不到的区块怎么处理，分两种情况：
 * - tabBar 的外观属性：uni-app 条件编译能把整段剥掉，保留并包上 #ifdef
 * - 没有任何页面的分包：构建产物里会留下指向不存在目录的空壳，直接删掉
 */

/** 由扫描/合并流水线组装出的路由数据 */
export interface PagesJsonData {
  /** 主包页面配置 */
  pages: InternalPages
  /** 分包页面配置 */
  subPackages: SubPackages
  /** 解析后的 tabBar 配置 */
  tabBar?: TabBar
  /**
   * 从扫描出的配置解析出的首页路径。从 pages.json 合并而来的条目
   * 可能缺少内部 `type` 标记（手写条目从不携带它），因此首页条目主要
   * 按路径重新定位；未设置时退回到 `type` 标记。
   */
  homePath?: string
}

/** 生成 pages.json 时怎么排版 */
export interface PagesJsonFormatOptions {
  /**
   * 压缩成一行输出，优先级高于 `indent`。单行 JSON 放不下注释，
   * 生成标记、用户注释、所有 `#ifdef` 块都会丢失：只属于其他平台的
   * 条目和区块会直接暴露在本平台的构建产物里（如外来的 tabBar
   * list），tabBar 外观属性也变成"谁最后写谁说了算"。所以同一个
   * 项目的所有平台要保持这个配置一致
   */
  minify?: boolean
  /** 缩进，空格数或字符串（如 '\t'） */
  indent?: number | string
  /** 换行符 */
  eol?: '\n' | '\r\n'
  /** 是否在末尾追加换行符 */
  insertFinalNewline?: boolean
}

export interface WritePagesJsonOptions {
  /** 当前平台标识，如 'mp-weixin' 或 'h5' */
  platform: string
  /** 来自 pages.config.ts 的用户配置；pages/subPackages/tabBar 之外的字段原样写进输出 */
  globConfig?: PagesConfig
  /** 序列化格式 */
  format?: PagesJsonFormatOptions
}

/** 纯合并步骤的选项：{@link WritePagesJsonOptions} 中与文件无关的部分 */
export type MergePagesJsonOptions = Pick<WritePagesJsonOptions, 'platform' | 'globConfig' | 'format'>

/**
 * tabBar 主体以文本方式渲染时，先在对象里放这个占位符序列化，最后
 * 再把渲染好的正文拼上去：按平台区分的属性需要同一个键出现多次，
 * comment-json 的对象做不到这一点，只能不用它、自己拼字符串
 * （见 {@link mergePagesJson}）
 */
const TAB_BAR_PLACEHOLDER = '@@uni-pages-tab-bar-placeholder@@'

/**
 * 把路由数据合并进 pages.json 并写回
 *
 * 整个"读取 → 合并 → 写回"都锁在同一把文件锁里：因为新内容要参考
 * 当前文件里其他平台的 `#ifdef` 块，两个终端同时跑（比如
 * dev:mp-weixin + dev:mp-alipay）时才不会互相覆盖或读到写了一半的
 * 内容。写入用临时文件 + rename，中途崩溃也不会留下截断的文件。
 *
 * @param jsonPath - pages.json 文件路径
 * @param data - 由扫描/合并流水线组装的路由数据
 * @param options - 平台、用户配置与序列化格式
 * @returns 写入结果；获取不到文件锁时为 undefined
 */
export async function writePagesJson(jsonPath: string, data: PagesJsonData, options: WritePagesJsonOptions): Promise<{ updated: boolean, content: string } | undefined> {
  return withFileLock(jsonPath, async () => {
    const existingContent = await fs.promises.readFile(jsonPath, { encoding: 'utf-8' }).catch(() => '')

    const content = mergePagesJson(existingContent, data, options)

    // 和刚从磁盘读到的内容比较，不要和进程内的缓存比较：pages.json
    // 可能被外部改写（编辑器保存、git checkout、其他工具），这时即使
    // 缓存和合并结果相同，也必须重写。磁盘已经等于合并结果时跳过写入
    // 永远是安全的
    if (existingContent === content) {
      debug.pages('PagesJson Not have change')
      return { updated: false, content }
    }

    // Windows: chokidar may hold pages.json open with a sharing mode that
    // blocks write-file-atomic's rename; retry up to 3 times before giving up.
    await retryOnEperm(() => writeFileAtomic(jsonPath, content))
    return { updated: true, content }
  })
}

/**
 * Retries an async operation up to 3 times on EPERM, waiting 50ms between
 * attempts. Other errors propagate immediately.
 *
 * Windows file rename (used by write-file-atomic) can fail with EPERM when
 * another process holds the destination open with a sharing mode that excludes
 * rename (e.g. chokidar's watcher). The lock clears in under a frame.
 */
export async function retryOnEperm(operation: () => Promise<unknown>): Promise<void> {
  for (let attempt = 3; attempt > 0; attempt--) {
    try {
      await operation()
      return
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 1)
        throw error
      await new Promise<void>(resolve => setTimeout(resolve, 50))
    }
  }
}

/**
 * 根据现有文件内容计算合并后的 pages.json 对象
 *
 * @returns pages.json 对象；美化输出模式下附带预渲染的 tabBar 主体
 * 行，用于替换序列化出的占位符（见 {@link mergePagesJson}）；
 * 为 undefined 表示没有 tabBar 或为紧凑输出
 */
function mergeIntoPagesJson(existingContent: string, data: PagesJsonData, options: MergePagesJsonOptions): { pageJson: PagesConfig, tabBarBodyLines?: string[] } {
  let oldConfig: CommentObject
  try {
    oldConfig = cjParse(existingContent || '{}') as CommentObject
  }
  catch (error: any) {
    // pages.json 手写出错（多半是编辑时少了逗号或引号）时，comment-json
    // 抛出的原始 SyntaxError 只有位置信息、看不出是哪个文件出的问
    // 题。带上文件外的上下文重新抛出，用户才知道去哪里修
    throw new Error(`[vite-plugin-uni-pages] Failed to parse the existing pages.json, please fix its syntax first: ${error?.message ?? error}`, { cause: error })
  }

  // pages.json 的根必须是对象。数字、字符串、布尔和 null 的语法合法，
  // 但 comment-json 会把它们装箱成对象，后面会静默覆盖或抛出没有文件
  // 上下文的 TypeError，等于跳过“拒绝覆盖手写内容”的保护。用 toString
  // 而不是 typeof：装箱原始值、数组和 null 都会露馅
  if (Object.prototype.toString.call(oldConfig) !== '[object Object]')
    throw new Error('[vite-plugin-uni-pages] The existing pages.json must contain a JSON object, please fix its syntax first')

  const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = oldConfig

  // pages 和 subPackages 必须是数组。手写错型（比如把数组写成了对象）
  // 时，subPackages 会在后面的遍历里抛出不知所云的 TypeError，
  // pages 的已有内容则被静默丢掉。这里统一给成和解析错误同样式的
  // 明确报错
  for (const [field, value] of Object.entries({ pages: oldPages, subPackages: oldSubPackages })) {
    if (value != null && !Array.isArray(value))
      throw new Error(`[vite-plugin-uni-pages] The "${field}" in the existing pages.json must be an array, please fix its syntax first`)
  }

  const { pages: _pages, subPackages: _subPackages, tabBar: _tabBar, ...pageJson } = options.globConfig || {}

  const currentPlatform = options.platform.toUpperCase()

  // pages
  const oldPagesArray = oldPages as unknown as CommentArray<CommentObject> | undefined
  // pages 不参与配置序重排：首页前置子系统会接管相对顺序（规则 6）
  pageJson.pages = mergePlatformItems(oldPagesArray, currentPlatform, data.pages, 'path').items as unknown as Pages

  // mergePlatformItems 内部用 Map 保存条目，顺序可能和首页在前的
  // 要求不一致，所以合并后要把首页挪到最前面
  ensureHomePageFirst(pageJson.pages as unknown as InternalPages | undefined, data.homePath)

  // subPackages
  pageJson.subPackages = oldSubPackages || new CommentArray<CommentObject>()
  const newSubPackages = new Map<string, SubPackage>()
  for (const item of data.subPackages) {
    newSubPackages.set(item.root, item)
  }
  // 用新的配置更新 pages.json 中已存在的分包
  const subPackagesArray = pageJson.subPackages as unknown as CommentArray<CommentObject>
  const staleRoots: string[] = []
  for (const existing of subPackagesArray as unknown as SubPackage[]) {
    const sub = newSubPackages.get(existing.root)
    if (sub) {
      // plugins 来自用户配置，跟着配置走：配置里有就写入，配置里删了
      // 就清掉。是不是插件生成的要在覆盖 pages 前判断，合并结果一
      // 律带新的生成标记，看合并后的数组永远为真。手写分包（没有
      // 标记）的 plugins 不碰
      const wasGenerated = hasGenerationMarker(existing.pages as unknown as CommentArray<CommentObject> | undefined)
      existing.pages = mergePlatformItems(existing.pages as unknown as CommentArray<CommentObject>, currentPlatform, sub.pages, 'path').items as unknown as Pages
      if (sub.plugins) {
        existing.plugins = sub.plugins
      }
      else if (wasGenerated) {
        Reflect.deleteProperty(existing, 'plugins')
      }
      newSubPackages.delete(existing.root)
    }
    else if (hasGenerationMarker(existing.pages as unknown as CommentArray<CommentObject> | undefined)) {
      // 本轮扫描不到、但确实是插件生成的分包（每个页面都通过
      // definePage(null) 退出，或目录被删了）：当前平台已经看不到它
      // 的任何页面，整个删掉。如果不删，这个 root 会以空分包的形式
      // 进入本平台的构建产物（app.json 里留一个 pages 为空的 root，
      // 指向不存在的目录）。删掉不丢状态：每个平台每次运行都会重新
      // 扫描并重写自己的条目，其他平台的进程下次写入时会把它加回来。
      // 手写的分包没有生成标记，原样保留
      staleRoots.push(existing.root)
    }
  }
  // 删掉上面收集的插件生成分包，注释和条目一起带走
  removeStaleSubPackages(subPackagesArray, staleRoots)
  // 追加 pages.json 中尚不存在的分包
  for (const [_, newSub] of newSubPackages) {
    const subPackage: SubPackage = {
      root: newSub.root,
      pages: mergePlatformItems(undefined, currentPlatform, newSub.pages, 'path').items as unknown as Pages,
    }
    // 配置了 plugins 属性时一并带上
    if (newSub.plugins) {
      subPackage.plugins = newSub.plugins
    }
    (pageJson.subPackages as unknown as SubPackage[]).push(subPackage)
  }

  // tabbar
  const { list, ...tabBarOthers } = data.tabBar || {}
  // 一次没有贡献任何 list 条目的运行（没有 tabBar，或 list 为空）也
  // 不拥有任何外观属性：它的配置不能抹掉拥有这些属性的平台的取值
  // （由测试锁定）
  const contributesProps = !!(list && list.length)
  const oldTabBarObj = oldTabBar as unknown as ({ list?: CommentArray<CommentObject> } & Partial<TabBar>) | undefined
  // 即使本轮没有 tabBar，也要针对当前平台清理列表：只属于本平台
  // 的条目从 list 中退出，其他平台的条目在自己的 #ifdef 块后面继续
  // 存活。pages.json 是各平台共享的，当前平台没有 tabBar，不代表可以
  // 删掉其他平台已经生成的整个区块
  // tabBar list 按配置顺序摆放（规则 6）：配置覆盖全部条目时整体重排；
  // 未覆盖时只落位新增条目，既有条目保持磁盘序。tab 顺序用户直接可
  // 见，且没有首页前置子系统的约束
  const tabBarMerge = mergePlatformItems(oldTabBarObj?.list, currentPlatform, list || [], 'pagePath', { orderByConfig: true })
  let tabBarBodyLines: string[] | undefined

  if (tabBarMerge.items.length === 0) {
    // 已经没有任何平台拥有 tabBar 条目：整个区块清空
    pageJson.tabBar = undefined
  }
  else {
    if (isPrettyFormat(options.format)) {
      // 美化输出能带上按平台区分的属性：同一个属性名写多次、各自
      // 包在互斥的 #ifdef 里（uni-app 按平台剥掉注释后每个平台只剩
      // 一个值）。comment-json 解不出重复键，所以已有的属性变体从
      // 原始文本里重新提取，tabBar 主体也绕开 comment-json 手工渲染
      const mergedProps = mergeTabBarProps(existingContent, tabBarOthers, contributesProps, currentPlatform, tabBarMerge.platformUnion)
      tabBarBodyLines = [
        ...renderTabBarPropLines(mergedProps, tabBarMerge.platformUnion, options.format),
        ...renderTabBarListLines(tabBarMerge.items, options.format),
      ]
      pageJson.tabBar = TAB_BAR_PLACEHOLDER as unknown as TabBar
    }
    else {
      // 紧凑输出放不下注释，按平台区分属性无从谈起：
      // 保持历史上的"谁最后写谁说了算"
      const { list: _oldList, ...oldTabBarOthers } = oldTabBarObj || {}
      pageJson.tabBar = {
        ...(contributesProps ? tabBarOthers : oldTabBarOthers),
        list: tabBarMerge.items,
      }
    }
    // tabBar 只对拥有至少一个 list 条目的平台可见。uni-app 的条件
    // 编译会把整个被包裹的属性剥掉，所以没有 tabBar 的平台本来就不
    // 该有这个区块。不包 #ifdef 的话，它们的构建产物会带上
    // `tabBar: { "list": [] }` 这样的空壳
    const tabBarPlatformStr = tabBarMerge.owningPlatforms.join(' || ')
    // owningPlatforms 为空说明 list 里只剩手写 #ifndef 条目：显示与否
    // 由每个条目自己的包裹决定，此时不能外层再包 #ifdef（会写出没有
    // 平台名的空指令，把整个 tabBar 从所有平台上剥掉）
    if (tabBarPlatformStr && tabBarPlatformStr !== tabBarMerge.platformUnion.join(' || ')) {
      const commentPageJson = pageJson as unknown as CommentObject
      commentPageJson[Symbol.for('before:tabBar') as CommentSymbol] = [lineComment(` #ifdef ${tabBarPlatformStr}`)]
      commentPageJson[Symbol.for('after:tabBar') as CommentSymbol] = [lineComment(' #endif')]
    }
  }

  return { pageJson: pageJson as PagesConfig, tabBarBodyLines }
}

/**
 * 判断输出是不是带注释的多行格式（只有多行才放得下按平台区分的
 * `#ifdef` 块）。`indent: 0` 或空字符串会让 comment-json 输出成
 * 单行，这里和它的行为保持一致。
 */
function isPrettyFormat(format: PagesJsonFormatOptions | undefined): boolean {
  return !(format?.minify ?? false) && !!(format?.indent ?? 2)
}

/**
 * 不碰文件系统，只做计算：把路由数据合并进现有 pages.json 文本
 * （多平台 `#ifdef` 块、首页重排、生成标记、过期分包清理）并序列化
 * 成字符串。文件锁、变更检测和原子写入都在 {@link writePagesJson}
 * 里；测试直接用字符串检查这个函数。
 *
 * @param existingContent - 当前 pages.json 文本，没有时传空字符串
 * @param data - 由扫描/合并流水线组装的路由数据
 * @param options - 平台、用户配置与序列化格式
 * @returns 序列化后的 pages.json 内容
 */
export function mergePagesJson(existingContent: string, data: PagesJsonData, options: MergePagesJsonOptions): string {
  const { pageJson, tabBarBodyLines } = mergeIntoPagesJson(existingContent, data, options)

  const minify = options.format?.minify ?? false
  const indent = options.format?.indent ?? 2
  const eol = options.format?.eol ?? '\n'
  let content = cjStringify(pageJson, null, minify ? undefined : indent)

  if (tabBarBodyLines) {
    // 把手工渲染的 tabBar 正文替换掉占位符。替换器必须用函数形式：
    // 正文里可能有 `$` 字符，字符串形式的替换器会把它们当成特殊
    // 替换模式处理
    const unit = typeof indent === 'number' ? ' '.repeat(indent) : indent
    content = content.replace(
      `"tabBar": ${JSON.stringify(TAB_BAR_PLACEHOLDER)}`,
      () => `"tabBar": {\n${tabBarBodyLines!.join('\n')}\n${unit}}`,
    )
  }

  if (eol !== '\n')
    content = content.replaceAll('\n', eol)

  if (options.format?.insertFinalNewline)
    content += eol

  return content
}
