import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { CommentLineToken, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
import type { ExcludeIndexSignature, InternalPageItem, InternalPages } from './types'
import fs from 'node:fs'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import writeFileAtomic from 'write-file-atomic'
import { withFileLock } from './files'
import { debug } from './logger'

/**
 * pages.json 的读取、合并、写回
 *
 * 这个文件负责 pages.json 的全部细节：
 * - 多个平台共用一个文件时，用 #ifdef 注释区分各自的条目
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
 * - 没有任何页面的子包：构建产物里会留下指向不存在目录的空壳，直接删掉
 */

/** 由扫描/合并流水线组装出的路由数据 */
export interface PagesJsonData {
  /** 主包页面配置 */
  pages: InternalPages
  /** 子包页面配置 */
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

    await writeFileAtomic(jsonPath, content)
    return { updated: true, content }
  })
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
  const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = oldConfig

  const { pages: _pages, subPackages: _subPackages, tabBar: _tabBar, ...pageJson } = options.globConfig || {}

  const currentPlatform = options.platform.toUpperCase()

  // pages
  const oldPagesArray = oldPages as unknown as CommentArray<CommentObject> | undefined
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
  // 用新的配置更新 pages.json 中已存在的子包
  const subPackagesArray = pageJson.subPackages as unknown as CommentArray<CommentObject>
  const staleRoots: string[] = []
  for (const existing of subPackagesArray as unknown as SubPackage[]) {
    const sub = newSubPackages.get(existing.root)
    if (sub) {
      // plugins 来自用户配置，跟着配置走：配置里有就写入，配置里删了
      // 就清掉。是不是插件生成的要在覆盖 pages 前判断——合并结果一
      // 律带新的生成标记，看合并后的数组永远为真。手写子包（没有
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
      // 本次运行扫描不到、但确实是插件生成的子包（每个页面都通过
      // definePage(null) 退出，或目录被删了）：当前平台已经看不到它
      // 的任何页面，整个删掉。如果不删，这个 root 会以空子包的形式
      // 进入本平台的构建产物（app.json 里留一个 pages 为空的 root，
      // 指向不存在的目录）。删掉不丢状态：每个平台每次运行都会重新
      // 扫描并重写自己的条目，其他平台的进程下次写入时会把它加回来。
      // 手写的子包没有生成标记，原样保留
      staleRoots.push(existing.root)
    }
  }
  // 删掉上面收集的插件生成子包。倒序遍历，先删除条目的注释符号再
  // splice，和 ensureHomePageFirst 的做法一致：comment-json 会把
  // 后面元素的注释挪到腾出来的位置上，这样邻居的 #ifdef 块在删除后
  // 还能保留。`after-value:i`（条目的 `}` 和 `,` 之间的用户注释）也
  // 必须删掉——splice 只挪注释、不删注释，留着它就会错误地挂到
  // 挪过来的那个条目上
  for (let i = subPackagesArray.length - 1; i >= 0; i--) {
    const existing = subPackagesArray[i] as unknown as SubPackage
    if (!staleRoots.includes(existing.root))
      continue
    debug.subPages(`Removing converged sub-package root: ${existing.root}`)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`after:${i}`) as CommentSymbol)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`after-value:${i}`) as CommentSymbol)
    subPackagesArray.splice(i, 1)
  }
  // 追加 pages.json 中尚不存在的子包
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
  // 即使本次运行没有 tabBar，也要针对当前平台清理列表：只属于本平台
  // 的条目从 list 中退出，其他平台的条目在自己的 #ifdef 块后面继续
  // 存活。pages.json 是各平台共享的，当前平台没有 tabBar，不代表可以
  // 删掉其他平台已经生成的整个区块
  const tabBarMerge = mergePlatformItems(oldTabBarObj?.list, currentPlatform, list || [], 'pagePath')
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
    // 该有这个区块——不包 #ifdef 的话，它们的构建产物会带上
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
 * 把所有首页条目移到最前面，注释跟着条目一起移动
 *
 * 每个平台可以在自己的 #ifdef 块里声明自己的首页，没被包裹的条目
 * 所有平台都能看到。所以一个平台的首页必须排在它可见的所有条目
 * 之前。解决办法很简单：把所有平台的首页都放到所有非首页条目的
 * 前面（各组内部顺序不变），一次满足所有平台。
 *
 * 只移动当前平台的首页是不够的：就算它已经在第 0 位，另一个平台的
 * 首页可能还排在它自己可见的某个非首页条目后面。
 *
 * 判断哪些条目是首页：先看条目自带的 `type: 'home'` 标记（扫描出来
 * 的条目都带），再看 homePath 路径兜底（手写条目不带标记）。标记在
 * 合并时不会保留下来，所以每次运行都要重新判断一遍。
 */
function ensureHomePageFirst(pagesArray: InternalPages | undefined, homePath: string | undefined): void {
  if (!pagesArray || pagesArray.length === 0)
    return

  // 从 pages.json 合并而来的条目可能缺少内部 `type` 标记（手写条目
  // 从不携带它）。当 homePath 的任何变体都不带首页标记时，退回到按
  // 路径匹配。扫描出的条目总带标记，所以光靠 `type === 'home'` 就能
  // 收集到每个平台的首页变体
  const isHome = pagesArray.map((page: InternalPageItem) => page.type === 'home')
  if (homePath && !pagesArray.some((page: InternalPageItem) => page.path === homePath && page.type === 'home')) {
    // 首页路径的每个变体都要标记，不能只标第一个：各平台的变体在
    // 各自的 #ifdef 块里，只标第一个的话，其他平台的变体会一直卡在
    // 非首页条目后面，要等之后的写入才碰巧修复
    pagesArray.forEach((page: InternalPageItem, index: number) => {
      if (page.path === homePath)
        isHome[index] = true
    })
  }

  const homeCount = isHome.filter(Boolean).length
  if (homeCount === 0)
    return

  // 首页已经都在前面了：不用移动，保持输出字节不变
  if (isHome.slice(0, homeCount).every(Boolean))
    return

  const commentArray = pagesArray as unknown as CommentArray<CommentObject>
  const length = pagesArray.length

  // `CommentArray#splice` 移动元素时会"聪明地"重排注释，但它的规则
  // 会把注释挂到错误的条目上（#ifdef/#endif 块和生成标记错位）。
  // 所以先把每个条目的注释记下来、删掉符号，让重排像普通数组一样
  // 干净地执行，最后再把注释按新位置挂回去。`after-value`（值后面
  // 同一行的注释）不用管：进到这个函数的数组是 mergePlatformItems
  // 刚构建的，只带 before/after 注释（#ifdef 块、生成标记、原样保留
  // 的 #ifndef 包裹层）；用户的 after-value 注释在更早的阶段已经被
  // 丢掉了，走不到这里（实测验证过）
  const beforeTokens: Array<CommentToken[]> = []
  const afterTokens: Array<CommentToken[]> = []
  for (let i = 0; i < length; i++) {
    beforeTokens.push(commentArray[Symbol.for(`before:${i}`) as CommentSymbol] || [])
    afterTokens.push(commentArray[Symbol.for(`after:${i}`) as CommentSymbol] || [])
    Reflect.deleteProperty(commentArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(commentArray, Symbol.for(`after:${i}`) as CommentSymbol)
  }

  // before:0 里混着生成标记和第一个条目自己的注释（比如它的
  // #ifdef 块）：标记留在数组顶部，条目自己的注释跟着条目走
  const markerTokens = beforeTokens[0].filter(isGenerationMarker)
  beforeTokens[0] = beforeTokens[0].filter(token => !isGenerationMarker(token))

  // 稳定分区：首页在前、其余在后，两组内部都保持原来的相对顺序
  const order: number[] = []
  for (let i = 0; i < length; i++) {
    if (isHome[i])
      order.push(i)
  }
  for (let i = 0; i < length; i++) {
    if (!isHome[i])
      order.push(i)
  }
  pagesArray.splice(0, length, ...order.map(i => pagesArray[i]))

  for (let i = 0; i < length; i++) {
    const sourceIndex = order[i]
    const before = i === 0 ? [...markerTokens, ...beforeTokens[sourceIndex]] : beforeTokens[sourceIndex]
    if (before.length > 0)
      commentArray[Symbol.for(`before:${i}`) as CommentSymbol] = before
    if (afterTokens[sourceIndex].length > 0)
      commentArray[Symbol.for(`after:${i}`) as CommentSymbol] = afterTokens[sourceIndex]
  }
}

const GENERATION_MARKER_PREFIX = 'GENERATED BY UNI-PAGES, PLATFORM:'

/** 判断注释令牌是否为 pages.json 的生成标记行 */
function isGenerationMarker(token: CommentLineToken | { type: string, value?: string }): boolean {
  return token.type !== 'BlankLine' && typeof token.value === 'string' && token.value.trim().startsWith(GENERATION_MARKER_PREFIX)
}

/** 判断一个 pages 数组是否由插件写入（携带生成标记） */
function hasGenerationMarker(src: CommentArray<CommentObject> | undefined): boolean {
  if (!src)
    return false
  return (src[Symbol.for('before:0') as CommentSymbol] || []).some(isGenerationMarker)
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
 * （多平台 `#ifdef` 块、首页重排、生成标记、过期子包清理）并序列化
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

/** 构建用于序列化 pages.json 输出的行注释令牌 */
function lineComment(value: string): CommentLineToken {
  return {
    type: 'LineComment',
    value,
    inline: false,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }
}

/** 从现有 pages.json 文本里提取出来的一条 tabBar 属性 */
interface RawTabBarProp {
  key: string
  /** 属性值（comment-json 解析结果，保留内部注释），用于比较和重新序列化 */
  value: unknown
  /** 紧挨着的第一条条件编译指令（如 `#ifdef H5 || MP-WEIXIN`、`#ifndef MP-ALIPAY`），没有包裹时为 null */
  condition: string | null
  /** 键前面 / 值后面的注释内容，重新原样输出 #ifndef 属性时要用 */
  beforeComments: string[]
  afterComments: string[]
}

/**
 * 跳过空白和注释往前走。遇到行注释或块注释时，注释里的文字（去掉
 * 首尾空白）会收集到 `comments` 里（如果传了）
 */
function skipJsoncFiller(content: string, index: number, comments?: string[]): number {
  let i = index
  while (i < content.length) {
    const ch = content[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (ch === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i)
      const stop = end === -1 ? content.length : end
      comments?.push(content.slice(i + 2, stop).trim())
      i = stop
      continue
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2)
      const stop = end === -1 ? content.length : end + 2
      comments?.push(content.slice(i + 2, end === -1 ? content.length : end).trim())
      i = stop
      continue
    }
    return i
  }
  return i
}

/** 从起始引号扫描 JSON 字符串字面量；返回闭合引号之后的下标 */
function scanJsonString(content: string, start: number): number {
  let i = start + 1
  while (i < content.length) {
    if (content[i] === '\\') {
      i += 2
      continue
    }
    if (content[i] === '"')
      return i + 1
    i++
  }
  return content.length
}

/** 扫描 `start` 处（定位在值的首字符）的 JSON 值；返回其后的下标 */
function scanJsonValue(content: string, start: number): number {
  const ch = content[start]
  if (ch === '"')
    return scanJsonString(content, start)
  if (ch === '{' || ch === '[') {
    let depth = 0
    let i = start
    while (i < content.length) {
      const c = content[i]
      if (c === '"') {
        i = scanJsonString(content, i)
        continue
      }
      if (c === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
        i = skipJsoncFiller(content, i)
        continue
      }
      if (c === '{' || c === '[') {
        depth++
        i++
        continue
      }
      if (c === '}' || c === ']') {
        depth--
        i++
        if (depth === 0)
          return i
        continue
      }
      i++
    }
    return content.length
  }
  // 没带引号的字面量（数字 / true / false / null）：读到下一个分隔符为止
  let i = start
  while (i < content.length && !',{}[] \t\r\n"'.includes(content[i]))
    i++
  return i
}

/** 读取 `start` 处（其起始引号）的 JSON 字符串字面量；返回解析文本与其后的下标 */
function readJsonStringToken(content: string, start: number): [string, number] | null {
  const end = scanJsonString(content, start)
  try {
    return [JSON.parse(content.slice(start, end)) as string, end]
  }
  catch {
    return null
  }
}

/**
 * 按文本扫描 pages.json 里的 tabBar 对象，把每个顶层属性连同它的
 * 条件编译包裹一起收集起来。
 *
 * 为什么要按文本扫：comment-json 解析时会按普通 JS 对象的规则，
 * 同一个键出现多次只留最后一个，而"同一个属性按平台写多个值"靠的
 * 就是重复键。
 * 这些信息一旦解析就丢了，所以必须从原始文本里捞回来。
 * tabBar 不是对象、或文件结构看不懂时返回 undefined。
 */
function extractTabBarProps(content: string): Map<string, RawTabBarProp[]> | undefined {
  let i = skipJsoncFiller(content, 0)
  if (content[i] !== '{')
    return undefined
  i = skipJsoncFiller(content, i + 1)

  while (i < content.length) {
    if (content[i] === '}' || content[i] !== '"')
      return undefined
    const token = readJsonStringToken(content, i)
    if (!token)
      return undefined
    const [key, keyEnd] = token
    i = skipJsoncFiller(content, keyEnd)
    if (content[i] !== ':')
      return undefined
    i = skipJsoncFiller(content, i + 1)
    if (key === 'tabBar') {
      if (content[i] !== '{')
        return undefined
      return parseTabBarProps(content, i + 1)
    }
    i = skipJsoncFiller(content, scanJsonValue(content, i))
    if (content[i] === ',')
      i = skipJsoncFiller(content, i + 1)
    else if (content[i] !== '}')
      return undefined
  }
  return undefined
}

/** 从 tabBar 对象起始 `{` 之后开始解析其内部 */
function parseTabBarProps(content: string, interiorStart: number): Map<string, RawTabBarProp[]> | undefined {
  const props = new Map<string, RawTabBarProp[]>()
  let beforeComments: string[] = []
  let i = skipJsoncFiller(content, interiorStart, beforeComments)
  // 条件栈：手写的条件块可以一次包住好几个属性（#ifdef 后面跟几行
  // 属性、最后才 #endif）。栈顶就是当前属性待在哪个条件里。旧代码只
  // 看每个属性自己紧挨着的注释，块里第二个之后的属性全部当成没有条
  // 件处理，被别的平台顶掉或漏出去。每个处于条件中的属性注册时都
  // 带上完整的包裹（开头指令 + 结尾 #endif），互相独立：渲染按键分
  // 组、按平台排序会把属性的顺序打乱，谁都不依赖邻居，输出才不会
  // 出现没闭合的 #ifndef
  const openConditions: string[] = []
  const applyCommentsToStack = (comments: string[]): void => {
    for (const comment of comments) {
      const trimmed = comment.trim()
      if (trimmed.startsWith('#endif')) {
        openConditions.pop()
      }
      else if (trimmed.startsWith('#ifdef') || trimmed.startsWith('#ifndef')) {
        openConditions.push(trimmed)
      }
    }
  }
  applyCommentsToStack(beforeComments)

  while (true) {
    if (i >= content.length)
      return undefined
    if (content[i] === '}')
      return props
    if (content[i] === ',') {
      const postComma: string[] = []
      i = skipJsoncFiller(content, i + 1, postComma)
      // 逗号后面的注释在文本上分属两处：开头的 #endif 关掉上一个属性
      // 待着的条件（comment-json 把 #endif 输出在值的逗号之后），剩下
      // 的跟着下一个属性走。#endif 不再挂到上一个属性身上：需要闭合
      // 符的 #ifndef 属性在注册时已经自带了
      applyCommentsToStack(postComma)
      beforeComments = postComma
      continue
    }
    if (content[i] !== '"')
      return undefined
    const token = readJsonStringToken(content, i)
    if (!token)
      return undefined
    const [key, keyEnd] = token
    i = skipJsoncFiller(content, keyEnd)
    if (content[i] !== ':')
      return undefined
    i = skipJsoncFiller(content, i + 1)
    const valueEnd = scanJsonValue(content, i)
    const rawValue = content.slice(i, valueEnd)

    const afterComments: string[] = []
    i = skipJsoncFiller(content, valueEnd, afterComments)
    if (content[i] !== ',' && content[i] !== '}')
      return undefined

    // 条件在应用值后面的注释之前读：那些注释（可能有关闭符或新的
    // 指令）在文本上位于这个属性之后，属于下一个属性的世界
    const condition = openConditions[openConditions.length - 1] ?? null
    applyCommentsToStack(afterComments)

    try {
      const value = cjParse(rawValue)
      let storedBefore = [...beforeComments]
      let storedAfter = afterComments
      if (condition?.startsWith('#ifndef')) {
        // #ifndef 属性自带完整包裹：开头指令统一重写为本属性的条件
        // （块里的后续属性自己的注释里没有它），结尾统一用合成的
        // #endif。注释里其他属性留下的结构性指令（上一个块的 #endif、
        // 重复的 #ifndef）全部滤掉——每个属性的包裹都是独立配对的，
        // 多余的指令只会输出成悬空的空块或没闭合的块；用户写的普通
        // 注释（说明文字）保留在指令后面
        storedBefore = [
          condition,
          ...beforeComments.filter(c => !/^#(?:ifdef|ifndef|endif)/.test(c.trim())),
        ]
        storedAfter = ['#endif', ...afterComments.filter(c => !c.trim().startsWith('#endif'))]
      }
      const raw: RawTabBarProp = { key, value, condition, beforeComments: storedBefore, afterComments: storedAfter }
      const variants = props.get(key) || []
      variants.push(raw)
      props.set(key, variants)
    }
    catch {
      // 值解析不出来：丢弃这条，本次运行会用自己的配置重写这个属性
    }
  }
}

/** 一条已经分好平台的 tabBar 属性变体（`list` 以外的所有属性） */
interface TabBarPropVariant {
  /** 用来比较的字符串形式：值去掉注释后 JSON.stringify */
  valueStr: string
  /** 原始的 comment-json 值（保留内部注释），重新序列化时用 */
  value: unknown
  /** 拥有这个值的平台；null 表示这是手写的 `#ifndef` 属性，原样保留 */
  platforms: string[] | null
  /** 原样保留时需要的包裹注释 */
  passthrough: { before: string[], after: string[] } | null
}

/**
 * 跨平台合并 tabBar 的外观属性（`list` 以外的所有属性）。
 * 规则和数组的 {@link mergePlatformItems} 一致：
 * - 包在 #ifdef 里的属性，属于注释里列出的那些平台
 * - 没包裹的属性，属于除当前平台外的所有平台（当前平台会写自己的）
 * - 一个值最后一个平台都不剩了，就删掉它
 * - 手写的 #ifndef 属性原样保留、永不删除，和数组侧的处理一致
 */
function mergeTabBarProps(
  existingContent: string,
  currentProps: Record<string, unknown>,
  contributesProps: boolean,
  currentPlatform: string,
  platformUnion: string[],
): Map<string, TabBarPropVariant[]> {
  const rawProps = extractTabBarProps(existingContent)
  const merged = new Map<string, TabBarPropVariant[]>()

  for (const [key, variants] of rawProps || []) {
    if (key === 'list')
      continue
    for (const raw of variants) {
      const valueStr = JSON.stringify(raw.value)
      if (valueStr === undefined)
        continue
      if (raw.condition?.startsWith('#ifndef')) {
        const list = merged.get(key) || []
        list.push({ valueStr, value: raw.value, platforms: null, passthrough: { before: raw.beforeComments, after: raw.afterComments } })
        merged.set(key, list)
        continue
      }
      let platforms: string[]
      if (raw.condition?.startsWith('#ifdef')) {
        platforms = platformsExcluding(raw.condition.slice('#ifdef'.length).trim(), currentPlatform)
      }
      else {
        platforms = platformUnion.filter(p => p !== currentPlatform)
      }
      if (platforms.length === 0)
        continue
      const list = merged.get(key) || []
      list.push({ valueStr, value: raw.value, platforms, passthrough: null })
      merged.set(key, list)
    }
  }

  if (contributesProps) {
    for (const [key, value] of Object.entries(currentProps)) {
      const valueStr = JSON.stringify(value)
      if (valueStr === undefined)
        continue
      const list = merged.get(key) || []
      // 值相同的 #ifndef 属性优先：如果当前平台没被 #ifndef 排除，
      // 那条手写属性本来就已经覆盖了它；如果当前平台正好被排除，
      // 尊重手写的隐藏规则。两种情况都不该再单独写一份
      if (list.some(v => v.platforms === null && v.valueStr === valueStr))
        continue
      const equal = list.find((v): v is TabBarPropVariant & { platforms: string[] } => v.platforms !== null && v.valueStr === valueStr)
      if (equal) {
        equal.platforms = [...equal.platforms, currentPlatform].sort()
      }
      else {
        list.push({ valueStr, value, platforms: [currentPlatform], passthrough: null })
        merged.set(key, list)
      }
    }
  }

  // 和 mergePlatformItems 一样按平台排好序再输出：当前平台原来的属性
  // 变体是从文件里读出来的，读进来时会被丢掉、再由本次运行补到列表
  // 末尾。两个平台轮流跑时，顺序就会来回跳，文件每次都有无意义的
  // 变动。排好序之后不管谁先谁后，写出来的都一样。#ifndef 属性
  // （platforms 为 null）排最前，这样文档承诺的"当前平台自己的值
  // 排在后面、优先生效"在与 #ifndef 重复键的场景下依然成立
  for (const variants of merged.values()) {
    variants.sort((a, b) => {
      const keyA = a.platforms === null ? '' : a.platforms.join(' || ')
      const keyB = b.platforms === null ? '' : b.platforms.join(' || ')
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
    })
  }

  return merged
}

/** 一层缩进是多少（空格数或字符串） */
function indentUnitOf(format: PagesJsonFormatOptions | undefined): string {
  const indent = format?.indent ?? 2
  return typeof indent === 'number' ? ' '.repeat(indent) : indent
}

/** 给除第一行以外的每一行加缩进（用于多行值拼进属性行的场景） */
function indentContinuation(text: string, extra: string): string {
  return text.split('\n').map((line, index) => index === 0 ? line : extra + line).join('\n')
}

/**
 * 把 tabBar 外观属性渲染成带缩进的输出行。所有平台都适用的值直接
 * 输出；其余每个值都写在自己的 `#ifdef` 块里（同一个键出现多次），
 * uni-app 按平台剥掉注释后，每个平台只会看到一个值。
 */
function renderTabBarPropLines(merged: Map<string, TabBarPropVariant[]>, platformUnion: string[], format: PagesJsonFormatOptions | undefined): string[] {
  const unit = indentUnitOf(format)
  const unionStr = platformUnion.join(' || ')
  const lines: string[] = []

  for (const [key, variants] of merged) {
    for (const variant of variants) {
      const valueText = indentContinuation(cjStringify(variant.value, null, format?.indent ?? 2), unit + unit)
      const propLine = `${unit}${unit}${JSON.stringify(key)}: ${valueText},`
      if (variant.passthrough) {
        for (const comment of variant.passthrough.before) {
          if (comment)
            lines.push(`${unit}${unit}// ${comment}`)
        }
        lines.push(propLine)
        for (const comment of variant.passthrough.after) {
          if (comment)
            lines.push(`${unit}${unit}// ${comment}`)
        }
        continue
      }
      const platformStr = (variant.platforms as string[]).join(' || ')
      if (platformStr === unionStr) {
        lines.push(propLine)
      }
      else {
        lines.push(`${unit}${unit}// #ifdef ${platformStr}`)
        lines.push(propLine)
        lines.push(`${unit}${unit}// #endif`)
      }
    }
  }
  return lines
}

/** 把合并后的 tabBar list 渲染成带缩进的输出行（list 总是 tabBar 的最后一个属性） */
function renderTabBarListLines(list: CommentArray<CommentObject>, format: PagesJsonFormatOptions | undefined): string[] {
  const unit = indentUnitOf(format)
  const text = cjStringify(list, null, format?.indent ?? 2)
  return text.split('\n').map((line, index) => {
    if (index === 0)
      return `${unit}${unit}"list": ${line}`
    return line === '' ? line : unit + unit + line
  })
}

/** 把 `||` 分隔的平台列表拆开，去掉当前平台，剩下的排好序 */
function platformsExcluding(platformList: string, currentPlatform: string): string[] {
  return platformList.split('||').map(p => p.trim()).filter(p => p !== currentPlatform).sort()
}

/**
 * 把条目转成字符串用于比较，比较前要先把内部的 `type` 标记
 * （'home' | 'page'）拿掉。
 *
 * 从 pages.json 读回来的条目可能没有这个标记（手写条目从不带它），
 * 直接 JSON.stringify 会把同一个页面当成两个不同的条目，多平台
 * 运行时就会生成重复的路由
 * （见 https://github.com/uni-helper/vite-plugin-uni-pages/issues/283）。
 *
 * 键的顺序也参与比较（JSON.stringify 按写入顺序输出）：同一页面在
 * 两个平台下键序不同时不会被合并，会各占一个 #ifdef 块留在文件
 * 里。代价只是文件里多一份内容相同的变体，构建时每个平台仍然只看
 * 得见自己那一条、不会出现重复路由，不值得为它做键序归一化。
 */
function stringifyForCompare<T extends object>(val: T): string {
  if ('type' in val) {
    const { type: _type, ...rest } = val
    return JSON.stringify(rest)
  }
  return JSON.stringify(val)
}

/**
 * 两个内容相同的条目，首页状态是否一致？
 *
 * `type` 标记不参与内容比较（见 stringifyForCompare），没有标记的
 * 条目也能和扫描到的条目合并。但如果两边都明确带着标记、而且一个
 * 是 'home' 一个是 'page'，说明这是两个平台各自声明的不同首页，
 * 必须作为两个条目待在各自的 #ifdef 块里，不能合并成一条——之前
 * 的合并正是"切换首页后旧首页标记残留、某个平台的首页声明被悄悄
 * 丢掉"这两个 bug 的根源。
 */
function homeStatusCompatible(a: object, b: object): boolean {
  const typeA = (a as InternalPageItem).type
  const typeB = (b as InternalPageItem).type
  return typeA === undefined || typeB === undefined || typeA === typeB
}

/** 一条合并后的条目及其出现的平台 */
interface MultiPlatformItem<T extends object> {
  item: T
  itemStr: string
  platforms: string[]
  platformStr: string
  /**
   * 手写 `#ifndef` 块原样保留所需的注释。插件只会记录"这个条目属于
   * 哪些平台"这种正向列表，表达不了"除了某平台之外"这种否定条件，
   * 所以此类条目按原样输出：保留它前面的注释（生成标记除外，数组
   * 会重新生成标记），#endif 闭合符在输出时补一个。这个块只包裹
   * 它紧跟的那一条。普通条目没有这个字段。
   */
  passthrough?: { before: CommentToken[], after: CommentToken[] }
}

/**
 * 从 before:0 的生成标记里读出上一次运行记录了哪些平台，
 * 去掉当前平台后返回
 */
function extractLastPlatforms(src: CommentArray<CommentObject>, currentPlatform: string): string[] {
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    // comment-json v5 遇到源文本里的空行会给出没有 `value` 的
    // BlankLine 令牌，比如手工整理过格式的 pages.json
    if (comment.type === 'BlankLine')
      continue

    const trimmed = comment.value.trim()
    if (trimmed.startsWith(GENERATION_MARKER_PREFIX)) {
      lastPlatforms = platformsExcluding(trimmed.split(':')[1], currentPlatform)
    }
  }
  return lastPlatforms
}

/**
 * 把所有条目记录的平台合在一起，算出"平台全集"
 *
 * 平台全集会写进生成标记，也决定哪些条目可以不加 #ifdef 直接输出：
 * 没被包裹的条目在 uni-app 条件编译下所有平台都看得见，所以只有
 * 覆盖了全部平台的条目才能"裸着"输出。
 *
 * 当前平台一定在全集里，哪怕这次运行一个条目都没贡献——比如页面
 * 只在 H5 存在，而 MP-WEIXIN 运行把每个页面都 definePage(null) 掉了。
 * 如果只从剩下的条目推全集，全集就只有 'H5'，H5 专属条目看起来
 * "覆盖了全集"，会不加包裹地输出，泄漏进微信的构建产物。老版本按
 * "最常用平台组合当默认值"的做法也有同样的问题：可能算出单平台
 * 组合，把那个平台的条目裸着输出，变成其他平台里的重复路由。这个
 * 全集同样管着 tabBar 属性的包裹：没有它，一次没有 tabBar 的运行
 * 会以为"拥有平台 == 全集"，把别的平台的 tabBar 裸着输出出去。
 *
 * 上一次运行记在标记里的平台也进全集。否则当某平台的条目都被
 * 重新扫描替换后，它"来过"这件事只记在标记里：只看条目推全集，
 * 全集会一会儿大一会儿小，条目一会儿包一会儿裸。把标记也算进来，
 * 全集就只增不减；多算的平台最多带来多余的包裹，不会泄漏。
 *
 * 只增不减的代价：彻底不用的平台会一直留在标记里。这无害，但别
 * 手工去改标记行——想清理就删掉整个生成的 pages.json，下次运行会
 * 从头生成。
 */
/**
 * 收集所有条目记录过的平台（不算当前平台和标记里记的平台），这个
 * 集合同时也是"拥有至少一个条目"的平台集合
 */
function collectVariantPlatforms<T extends object>(mergedMap: Map<string, MultiPlatformItem<T>[]>): Set<string> {
  const platforms = new Set<string>()
  for (const variants of mergedMap.values()) {
    for (const { platforms: variantPlatforms } of variants) {
      for (const platform of variantPlatforms)
        platforms.add(platform)
    }
  }
  return platforms
}

function resolvePlatformUnion<T extends object>(mergedMap: Map<string, MultiPlatformItem<T>[]>, currentPlatform: string, lastPlatforms: string[]): string[] {
  const union = new Set<string>([currentPlatform, ...lastPlatforms, ...collectVariantPlatforms(mergedMap)])
  return [...union].sort()
}

/** {@link mergePlatformItems} 的返回结果：合并后的条目和相关的平台集合 */
interface MergedPlatformItems {
  /** 合并后的条目（带 #ifdef 块和生成标记） */
  items: CommentArray<CommentObject>
  /** 平台全集：当前平台、标记里记的上次平台、所有条目的平台，排好序 */
  platformUnion: string[]
  /**
   * 至少还拥有一个条目的平台。tabBar 这种"整块按平台显示隐藏"的
   * 场景只需要对这些平台展示；在这里直接算好，调用方不用回头去
   * 解析输出里的 #ifdef 注释。
   */
  owningPlatforms: string[]
}

/**
 * 合并多平台的配置条目。
 *
 * 处理条件编译注释（#ifdef / #ifndef / #endif），把 pages.json 里
 * 已有的条目和本次扫描的条目合并成一个数组：
 * - 内容相同的条目自动合并，平台标识叠在一起
 * - 内容不同的条目各写各的 #ifdef 块
 * - 手写的 `#ifndef` 块原样保留：否定条件翻译不成正向平台列表，
 *   所以条目连同原始包裹一起输出，永不修改、也永不清理
 *
 * @param source - 现有条目数组（来自 pages.json）
 * @param currentPlatform - 当前平台标识（如 H5、MP-WEIXIN）
 * @param items - 新配置条目数组
 * @param uniqueKeyName - 用于识别条目唯一性的字段名（如 'path' 或 'pagePath'）
 * @returns 带 #ifdef 块的合并条目，以及平台全集与拥有平台
 */
function mergePlatformItems<T extends object = Record<string, unknown>>(source: CommentArray<CommentObject> | undefined, currentPlatform: string, items: T[], uniqueKeyName: keyof ExcludeIndexSignature<T>): MergedPlatformItems {
  const src = source || new CommentArray<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. 从生成标记读取上一次运行记录的平台
  const lastPlatforms = extractLastPlatforms(src, currentPlatform)

  // 2. 遍历现有数组，逐个判断，以 uniqueKey 的值为键放进 mergedMap
  const mergedMap = new Map<string, MultiPlatformItem<T>[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as unknown as T
    const uniqueKey = (item as Record<string, unknown>)[uniqueKeyName as string] as string

    if (!uniqueKey) {
      continue
    }

    // 检查条目前面有没有条件编译注释
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // BlankLine 令牌没有 `value`，先跳过再匹配。只认 #ifdef/#ifndef
    // 开头：comment-json 会把包裹层的 #endif（输出在值的逗号后面）
    // 挂到下一个条目前面，绝不能把它当成开启符
    const conditionalComment = beforeComments?.find((c): c is CommentLineToken => c.type !== 'BlankLine' && /^#(?:ifdef|ifndef)/.test(c.value.trim()))

    // 手写的 `#ifndef` 块原样保留："除了某平台以外"翻译不成正向
    // 平台列表，所以条目保留原始注释、不参与清理（文档承诺过
    // 「手写内容永不修改」）。插件自己从不输出 `#ifndef`，所以这种
    // 块一定出自用户之手。#endif 在输出时补写；挂在后续条目前面的
    // 游离 #endif 被上面的匹配规则跳过，重建包裹层时自然丢掉
    if (conditionalComment?.value.trim().startsWith('#ifndef')) {
      const existing = mergedMap.get(uniqueKey) || []
      existing.push({
        item,
        itemStr: stringifyForCompare(item),
        platforms: [],
        platformStr: '',
        passthrough: {
          before: [...(beforeComments || [])].filter(c => !isGenerationMarker(c)),
          after: [lineComment(' #endif')],
        },
      })
      mergedMap.set(uniqueKey, existing)
      continue
    }

    let platforms: string[] = [...lastPlatforms]

    if (conditionalComment) {
      const match = conditionalComment.value.match(/#ifdef\s+(.+)/)
      if (match) {
        // 去掉当前平台
        platforms = platformsExcluding(match[1], currentPlatform)
      }
    }

    // 剩下的平台只有当前平台自己（或为空）时，跳过这个条目——
    // 本次运行会写出自己的版本。
    // 注意：没有生成标记、也没包 #ifdef 的手写条目也会在这里被丢掉
    // （当它不在本次扫描结果里时，解析出的平台列表是空的）。这是
    // 一直以来的行为，保持不变；想每次运行都保留的手写页面，请写进
    // pages.config.ts 的 `pages`，它会无条件合并进来
    if (platforms.length === 0) {
      continue
    }

    const existing = mergedMap.get(uniqueKey) || []
    existing.push({ item, itemStr: stringifyForCompare(item), platforms, platformStr: platforms.join(' || ') })
    mergedMap.set(uniqueKey, existing)
  }

  // 3. 把本次扫描的条目合并进 mergedMap
  // 扫描条目上的 `type` 标记按设计保留（后面运行里 ensureHomePageFirst
  // 找首页要用它）；只有比较两条配置相不相等时才把它拿掉
  // （stringifyForCompare）
  for (const item of items) {
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey) {
      continue
    }

    if (!mergedMap.has(uniqueKey)) {
      // 还没有这个条目：直接加入
      mergedMap.set(uniqueKey, [{
        item,
        itemStr: stringifyForCompare(item),
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      }])
      continue
    }

    // 已有同键条目：看看内容是否相同
    const existing = mergedMap.get(uniqueKey)!

    const itemStr = stringifyForCompare(item)
    // 内容相同的手写 #ifndef 条目优先：当前平台没被排除时，那条
    // #ifndef 已经覆盖了它；当前平台正好被排除时，隐藏扫描条目正是
    // 尊重手写的排除规则。两种情况下再单独写一份都会产生重复路由
    // 或覆盖用户的条件
    if (existing.some(val => val.passthrough && val.itemStr === itemStr && homeStatusCompatible(val.item, item)))
      continue
    const equalObj = existing.find(val => !val.passthrough && val.itemStr === itemStr && homeStatusCompatible(val.item, item))
    if (equalObj) {
      equalObj.platforms.push(currentPlatform)
      equalObj.platforms.sort()
      equalObj.platformStr = equalObj.platforms.join(' || ')
    }
    else {
      existing.push({
        item,
        itemStr,
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      })
    }
  }

  // 4. 遍历 mergedMap 生成结果：CommentArray<CommentObject>
  const result = new CommentArray<CommentObject>()

  // 输出前按平台列表把每个键的变体排好序：当前平台的变体在步骤 2
  // 里被丢掉、步骤 3 里又补到列表末尾，两个平台轮流运行（dev:h5 和
  // dev:mp-weixin 交替写）时，同一键的变体顺序就会来回翻转——条件
  // 编译的结果没变，但文件每次都有无意义的变动。platformStr 由排好
  // 序的平台列表拼成（platformsExcluding / resolvePlatformUnion 都
  // 排过序），手写 #ifndef 条目是空串、排最前，所以不管写入顺序
  // 怎样，输出都一样。排序是稳定的：并列时（同键两组平台列表相同，
  // 只在手写文件里出现）保持文件里的顺序
  for (const variants of mergedMap.values()) {
    variants.sort((a, b) => (a.platformStr < b.platformStr ? -1 : a.platformStr > b.platformStr ? 1 : 0))
  }

  // 只有覆盖全部平台的条目才能不加 #ifdef 直接输出：没包裹的条目
  // 所有平台都看得见，覆盖面小的条目必须包起来，免得漏进其他平台。
  // resolvePlatformUnion 一定会把当前平台和标记里记的平台放进全集，
  // 所以一次零贡献的运行也会逼着别人的条目保持包裹，早先运行记下
  // 的平台身份也不会在平台重跑后丢失
  const platformUnion = resolvePlatformUnion(mergedMap, currentPlatform, lastPlatforms)
  const platformUnionStr = platformUnion.join(' || ')

  // 一个平台只要还有至少一个条目，就算它拥有这个区块；
  // 把所有条目的平台直接合在一起，就得到拥有平台的集合
  const owningPlatforms = collectVariantPlatforms(mergedMap)

  // 把生成标记写进 result 的 Symbol.for(`before:0`)
  result[Symbol.for('before:0') as CommentSymbol] = [lineComment(` ${GENERATION_MARKER_PREFIX} ${platformUnionStr}`)]

  // 按插入顺序处理元素
  for (const [_, list] of mergedMap) {
    for (const { item, platformStr, passthrough } of list) {
      result.push(item as unknown as CommentObject)

      // 手写 #ifndef 块：把原始包裹注释原样放回去
      // （存下的注释里已包含 #ifndef 和 #endif 行）
      if (passthrough) {
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [
          ...(result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] || []),
          ...passthrough.before,
        ]
        if (passthrough.after.length > 0)
          result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = passthrough.after
        continue
      }

      // 这个条目是否覆盖了全部平台（两个字符串都是排好序的）
      if (platformStr !== platformUnionStr) {
        // 只覆盖一部分平台：包上 #ifdef，让其他平台看不见它。
        // 注意是追加而不是覆盖：before:0 里可能已经有生成标记，
        // 标记必须待在数组最前面
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [
          ...(result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] || []),
          lineComment(` #ifdef ${platformStr}`),
        ]

        result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = [lineComment(' #endif')]
      }
    }
  }

  return { items: result, platformUnion, owningPlatforms: [...owningPlatforms].sort() }
}
