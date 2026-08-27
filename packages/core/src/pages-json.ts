import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { CommentLineToken, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
import type { PlatformVariant } from './platform-variants'
import type { ExcludeIndexSignature, InternalPageItem, InternalPages } from './types'
import fs from 'node:fs'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import writeFileAtomic from 'write-file-atomic'
import { withFileLock } from './files'
import { debug } from './logger'
import {
  collectVariantPlatforms,
  extractLastPlatforms,
  GENERATION_MARKER_PREFIX,
  hasGenerationMarker,
  isGenerationMarker,
  platformsExcluding,
  resolvePlatformUnion,
  sortVariants,
  upsertCurrentVariant,
} from './platform-variants'
import { mergeTabBarProps, renderTabBarListLines, renderTabBarPropLines } from './tab-bar'

/**
 * pages.json 的读取、合并、写回
 *
 * 这个文件负责 pages.json 的主流程：
 * - 多个平台共用一个文件时，用 #ifdef 注释区分各自的条目（合并规则
 *   的核心在 platform-variants.ts，数组侧的适配在这里，对象侧
 *   tabBar 属性的适配在 tab-bar.ts）
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

  // pages 和 subPackages 必须是数组。手写错型（比如把数组写成了对象）
  // 时，subPackages 会在后面的遍历里抛出不知所云的 TypeError，
  // pages 的已有内容则被静默丢掉——这里统一给成和解析错误同样式的
  // 明确报错
  for (const [field, value] of Object.entries({ pages: oldPages, subPackages: oldSubPackages })) {
    if (value != null && !Array.isArray(value))
      throw new Error(`[vite-plugin-uni-pages] The "${field}" in the existing pages.json must be an array, please fix its syntax first`)
  }

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

/** 一条合并后的条目及其出现的平台（数组侧的变体形状） */
interface MultiPlatformItem<T extends object> extends PlatformVariant<T> {
  /**
   * 手写 `#ifndef` 块原样保留所需的注释。插件只会记录"这个条目属于
   * 哪些平台"这种正向列表，表达不了"除了某平台之外"这种否定条件，
   * 所以此类条目按原样输出：保留它前面的注释（生成标记除外，数组
   * 会重新生成标记），#endif 闭合符在输出时补一个。这个块只包裹
   * 它紧跟的那一条。普通条目没有这个字段。
   */
  passthrough?: { before: CommentToken[], after: CommentToken[] }
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
 * 合并多平台的配置条目（数组侧适配器）。
 *
 * 处理条件编译注释（#ifdef / #ifndef / #endif），把 pages.json 里
 * 已有的条目和本次扫描的条目合并成一个数组；合并规则（同值叠平台、
 * 排除当前平台、排序、并集）用 platform-variants.ts 的共享核心：
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
  // 取这个键的变体列表，没有就建一个并注册进 mergedMap
  const variantsOf = (uniqueKey: string): MultiPlatformItem<T>[] => {
    const list = mergedMap.get(uniqueKey) || []
    mergedMap.set(uniqueKey, list)
    return list
  }

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
      variantsOf(uniqueKey).push({
        payload: item,
        valueStr: stringifyForCompare(item),
        platforms: null,
        platformStr: '',
        passthrough: {
          before: [...(beforeComments || [])].filter(c => !isGenerationMarker(c)),
          after: [lineComment(' #endif')],
        },
      })
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

    variantsOf(uniqueKey).push({ payload: item, valueStr: stringifyForCompare(item), platforms, platformStr: platforms.join(' || ') })
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

    // 规则见 platform-variants 的 upsertCurrentVariant：同值叠平台、
    // 同值 #ifndef 优先；compatible 用来区分两个平台各自声明的不同
    // 首页（homeStatusCompatible）
    upsertCurrentVariant(variantsOf(uniqueKey), item, stringifyForCompare(item), currentPlatform, homeStatusCompatible)
  }

  // 4. 遍历 mergedMap 生成结果：CommentArray<CommentObject>
  const result = new CommentArray<CommentObject>()

  // 输出前按平台列表把每个键的变体排好序（规则见 platform-variants
  // 的 sortVariants）：当前平台的变体在步骤 2 里被丢掉、步骤 3 里又
  // 补到列表末尾，两个平台轮流运行（dev:h5 和 dev:mp-weixin 交替
  // 写）时，同一键的变体顺序就会来回翻转
  for (const variants of mergedMap.values()) {
    sortVariants(variants)
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
    for (const { payload: item, platformStr, passthrough } of list) {
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
