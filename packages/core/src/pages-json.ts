import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { CommentLineToken, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
import type { ExcludeIndexSignature, InternalPageItem, InternalPages } from './types'
import fs from 'node:fs'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import writeFileAtomic from 'write-file-atomic'
import { withFileLock } from './files'
import { debug } from './logger'

/**
 * pages.json 读-改-写模块
 *
 * 深模块，封装所有 pages.json 专属细节：多平台 #ifdef 合并、带注释
 * 挂载修复的首页重排、生成标记处理、序列化格式化、文件锁与原子写入。
 * 调用方只见 {@link writePagesJson} 与纯函数 {@link mergePagesJson}；
 * comment-json 内部结构从不越过它们的接口泄漏。
 *
 * 当前平台不使用的区块的收敛策略：当 uni-app 条件编译能把整个区块
 * 从该平台的构建中剥掉时保留并 #ifdef 包裹（tabBar 属性）；当构建
 * 产物仍会带出空壳时整个丢弃（没有页面的子包 root）。
 */

/** 由扫描/合并流水线组装出的路由数据 */
export interface PagesJsonData {
  /** 主包页面元信息 */
  pages: InternalPages
  /** 子包页面元信息 */
  subPackages: SubPackages
  /** 解析后的 tabBar 配置 */
  tabBar?: TabBar
  /**
   * 从扫描出的元信息解析出的首页路径。从 pages.json 合并而来的条目
   * 可能缺少内部 `type` 标记（手写条目从不携带它），因此首页条目主要
   * 按路径重新定位；未设置时退回到 `type` 标记。
   */
  homePath?: string
}

/** 生成 pages.json 的序列化选项 */
export interface PagesJsonFormatOptions {
  /**
   * 压缩输出，优先级高于 `indent`。单行 JSON 无法携带注释，生成
   * 标记、用户注释与所有平台作用域的 `#ifdef` 块都会被丢弃：仅由
   * 其他平台拥有的条目与区块会裸露地进入本平台的构建产物（如外来的
   * tabBar list），tabBar 外观属性的跨平台跟踪退化为最后写入者胜出；
   * 且一旦发生一次压缩写入，多平台跟踪在后续每次运行都从头开始。
   * 同一项目所有平台的构建应保持该配置一致
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
  /** 来自 pages.config.ts 的用户配置；pages/subPackages/tabBar 之外的字段原样透传到输出 */
  globConfig?: PagesConfig
  /** 序列化格式 */
  format?: PagesJsonFormatOptions
}

/** 纯合并步骤的选项：{@link WritePagesJsonOptions} 中与文件无关的部分 */
export type MergePagesJsonOptions = Pick<WritePagesJsonOptions, 'platform' | 'globConfig' | 'format'>

/**
 * tabBar 主体以文本方式渲染时，占位符序列化为 tabBar 的值：按平台
 * 区分的属性变体需要重复键，comment-json 对象无法表达，因此主体在
 * 最终字符串中拼接到这个占位符上（见 {@link mergePagesJson}）
 */
const TAB_BAR_PLACEHOLDER = '@@uni-pages-tab-bar-placeholder@@'

/**
 * 将给定路由数据合并进 pages.json 并写回
 *
 * 整个读-改-写运行在同一把文件锁内：新内容取决于当前内容（其他平台
 * 的 `#ifdef` 块），并发终端（如 dev:mp-weixin + dev:mp-alipay）因此
 * 不会观察到或覆写彼此的半写入状态。写入是原子的（临时文件 +
 * rename），写入中途崩溃不会留下截断的文件。
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

    // 与刚从磁盘读到的内容比较，绝不与进程内缓存比较：pages.json 被
    // 外部覆写（编辑器保存、git checkout、其他工具）时，即使缓存仍
    // 等于合并结果，也必须被检测到并重写。磁盘已经等于合并结果时，
    // 写入会是字节相同的空操作，跳过始终安全。
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
 * 行为 undefined 表示没有 tabBar 或为紧凑输出
 */
function mergeIntoPagesJson(existingContent: string, data: PagesJsonData, options: MergePagesJsonOptions): { pageJson: PagesConfig, tabBarBodyLines?: string[] } {
  const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = cjParse(existingContent || '{}') as CommentObject

  const { pages: _pages, subPackages: _subPackages, tabBar: _tabBar, ...pageJson } = options.globConfig || {}

  const currentPlatform = options.platform.toUpperCase()

  // pages
  const oldPagesArray = oldPages as unknown as CommentArray<CommentObject> | undefined
  pageJson.pages = mergePlatformItems(oldPagesArray, currentPlatform, data.pages, 'path').items as unknown as Pages

  // mergePlatformItems 内部使用 Map，可能丢失 setHomePage 给出的顺序，
  // 因此合并后需要确保首页排在最前
  ensureHomePageFirst(pageJson.pages as unknown as InternalPages | undefined, data.homePath)

  // subPackages
  pageJson.subPackages = oldSubPackages || new CommentArray<CommentObject>()
  const newSubPackages = new Map<string, SubPackage>()
  for (const item of data.subPackages) {
    newSubPackages.set(item.root, item)
  }
  // 用新的元信息更新 pages.json 中已存在的子包
  const subPackagesArray = pageJson.subPackages as unknown as CommentArray<CommentObject>
  const staleRoots: string[] = []
  for (const existing of subPackagesArray as unknown as SubPackage[]) {
    const sub = newSubPackages.get(existing.root)
    if (sub) {
      existing.pages = mergePlatformItems(existing.pages as unknown as CommentArray<CommentObject>, currentPlatform, sub.pages, 'path').items as unknown as Pages
      // 保留用户配置中的 plugins 属性
      if (sub.plugins) {
        existing.plugins = sub.plugins
      }
      newSubPackages.delete(existing.root)
    }
    else if (hasGenerationMarker(existing.pages as unknown as CommentArray<CommentObject> | undefined)) {
      // 本次运行扫描不到的插件生成子包（每个页面都通过 definePage(null)
      // 退出，或目录已被删除）：当前平台在其中已无可见页面，整个 root
      // 直接丢弃。若选择收敛而非丢弃，其他平台的条目会保持包裹，但
      // root 本身仍会以空子包的形式进入本平台的构建产物（app.json 中
      // 保留一个 pages 数组为空的 root）。丢弃不丢状态：每个平台每次
      // 运行都会重新扫描并重写自己的条目，其他平台的进程会在下次写入
      // 时把 root 加回来。手写的子包不携带生成标记，原样保留。
      staleRoots.push(existing.root)
    }
  }
  // 丢弃上面收集的插件生成子包。倒序遍历，先删除条目的注释符号再
  // splice，与 ensureHomePageFirst 的做法一致：这样 comment-json 会把
  // 后续元素的注释移入腾出的槽位，邻居的 #ifdef 块因此在删除后得以
  // 保留。`after-value:i`（条目的 `}` 与 `,` 之间的用户注释）也必须
  // 删除——splice 只移动幸存元素的注释，不删它就会泄漏给移入该槽位
  // 的任何条目。
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
  // 一次没有贡献 list 条目的运行（无 tabBar，或 list 为空/缺失）同样
  // 不拥有任何外观属性：它的配置不得抹掉拥有平台的属性（由测试锁定）
  const contributesProps = !!(list && list.length)
  const oldTabBarObj = oldTabBar as unknown as ({ list?: CommentArray<CommentObject> } & Partial<TabBar>) | undefined
  // 即使本次运行没有贡献 tabBar，也针对当前平台收敛：仅由本平台拥有
  // 的条目从 list 中退出，外来条目在其 #ifdef 块后幸存。pages.json 为
  // 各平台共享，当前平台没有 tabBar 不得删掉其他平台已生成的整个区块。
  const tabBarMerge = mergePlatformItems(oldTabBarObj?.list, currentPlatform, list || [], 'pagePath')
  let tabBarBodyLines: string[] | undefined

  if (tabBarMerge.items.length === 0) {
    // 已无任何平台拥有 tabBar 条目：区块收敛为空
    pageJson.tabBar = undefined
  }
  else {
    if (isPrettyFormat(options.format)) {
      // 美化输出可以携带按平台区分的属性变体：分叉的属性以互斥
      // #ifdef 块下的重复键输出（uni-app 按平台剥掉注释，只留下一个
      // 值）。comment-json 无法往返重复键，因此已有变体从原始文本中
      // 恢复，tabBar 主体在 comment-json 序列化之外渲染
      const mergedProps = mergeTabBarProps(existingContent, tabBarOthers, contributesProps, currentPlatform, tabBarMerge.platformUnion)
      tabBarBodyLines = [
        ...renderTabBarPropLines(mergedProps, tabBarMerge.platformUnion, options.format),
        ...renderTabBarListLines(tabBarMerge.items, options.format),
      ]
      pageJson.tabBar = TAB_BAR_PLACEHOLDER as unknown as TabBar
    }
    else {
      // 紧凑输出无法携带注释，按平台的属性无从谈起：
      // 保持历史上的最后写入者胜出语义
      const { list: _oldList, ...oldTabBarOthers } = oldTabBarObj || {}
      pageJson.tabBar = {
        ...(contributesProps ? tabBarOthers : oldTabBarOthers),
        list: tabBarMerge.items,
      }
    }
    // tabBar 只对拥有至少一个 list 条目的平台可见。uni-app 的条件编译
    // 会剥掉整个被包裹的属性，因此没有 tabBar 的平台根本不该有这个
    // 区块——不包裹的话，它们的构建产物会带出 `tabBar: { "list": [] }`
    const tabBarPlatformStr = tabBarMerge.owningPlatforms.join(' || ')
    if (tabBarPlatformStr !== tabBarMerge.platformUnion.join(' || ')) {
      const commentPageJson = pageJson as unknown as CommentObject
      commentPageJson[Symbol.for('before:tabBar') as CommentSymbol] = [lineComment(` #ifdef ${tabBarPlatformStr}`)]
      commentPageJson[Symbol.for('after:tabBar') as CommentSymbol] = [lineComment(' #endif')]
    }
  }

  return { pageJson: pageJson as PagesConfig, tabBarBodyLines }
}

/**
 * 把所有首页条目移到最前，同时保持注释挂载完整
 *
 * 每个平台可以在 #ifdef 块后声明自己的首页，未包裹的条目对所有平台
 * 可见。一个平台的首页因此必须排在该平台可见的所有条目之前；把全部
 * 首页变体放到所有非首页条目之前（稳定分区）一次性满足所有平台的
 * 视图。只移动当前平台的首页不够：一旦它的首页已位于下标 0，另一个
 * 平台的首页仍可能滞留在该平台可见的某个非首页条目之后。
 *
 * 该保证覆盖携带内部 `type` 标记的条目（每个扫描条目都携带），外加
 * 通过下方兜底覆盖 homePath 解析结果的每个未标记变体；标记本身从不
 * 在合并后的对象上恢复，因此兜底每次运行都从 homePath 重新推导首页
 * 状态。
 */
function ensureHomePageFirst(pagesArray: InternalPages | undefined, homePath: string | undefined): void {
  if (!pagesArray || pagesArray.length === 0)
    return

  // 从 pages.json 合并而来的条目可能缺少内部 `type` 标记（手写条目
  // 从不携带它），当 homePath 的任何变体都不携带首页标记时，退回到
  // 从扫描元信息解析出的路径。扫描条目总携带标记，因此仅凭
  // `type === 'home'` 就能收集到每个平台的首页变体。
  const isHome = pagesArray.map((page: InternalPageItem) => page.type === 'home')
  if (homePath && !pagesArray.some((page: InternalPageItem) => page.path === homePath && page.type === 'home')) {
    // 标记首页路径的每个变体，而不只是第一个：每个平台的变体可能位于
    // 各自的 #ifdef 块后，只标记第一个会让当前平台的变体滞留在可见的
    // 非首页条目之后，直到后续某次自愈写入
    pagesArray.forEach((page: InternalPageItem, index: number) => {
      if (page.path === homePath)
        isHome[index] = true
    })
  }

  const homeCount = isHome.filter(Boolean).length
  if (homeCount === 0)
    return

  // 已分区——每个首页变体都排在非首页条目之前：无需移动，
  // 保持重跑间的字节级输出稳定
  if (isHome.slice(0, homeCount).every(Boolean))
    return

  const commentArray = pagesArray as unknown as CommentArray<CommentObject>
  const length = pagesArray.length

  // `CommentArray#splice` 只会重排幸存元素的注释：被移除槽位的注释
  // 会滞留到移入的元素上，错置 `#ifdef`/`#endif` 块与生成标记。先
  // 快照每个条目的注释令牌并删除符号，让重排按普通数组语义运行，
  // 再有意识地重新挂载令牌。`after-value` 无需处理：`pagesArray` 是
  // mergePlatformItems 刚构建的输出，其注释令牌只有 `before`/`after`
  // 条目（#ifdef 块、生成标记与原样透传的 #ifndef 包裹层）；用户的
  // after-value 注释在更早的阶段已被丢弃，到不了这个函数（已实测
  // 验证）。
  const beforeTokens: Array<CommentToken[]> = []
  const afterTokens: Array<CommentToken[]> = []
  for (let i = 0; i < length; i++) {
    beforeTokens.push(commentArray[Symbol.for(`before:${i}`) as CommentSymbol] || [])
    afterTokens.push(commentArray[Symbol.for(`after:${i}`) as CommentSymbol] || [])
    Reflect.deleteProperty(commentArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(commentArray, Symbol.for(`after:${i}`) as CommentSymbol)
  }

  // before:0 把生成标记与第一个条目自己的注释（如它的 #ifdef 块）
  // 混在一起：标记保持在数组顶部，条目令牌随条目移动
  const markerTokens = beforeTokens[0].filter(isGenerationMarker)
  beforeTokens[0] = beforeTokens[0].filter(token => !isGenerationMarker(token))

  // 稳定分区：首页变体在前，其余在后，各自保持原有相对顺序
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
 * 判断该格式是否渲染可携带注释的多行输出（也因此能携带按平台的
 * `#ifdef` 块）。`indent: 0` 或空字符串会让 comment-json 退化为单行
 * 输出，这里与它自身的行为保持一致。
 */
function isPrettyFormat(format: PagesJsonFormatOptions | undefined): boolean {
  return !(format?.minify ?? false) && !!(format?.indent ?? 2)
}

/**
 * 不触碰文件系统，计算合并后的 pages.json 内容字符串
 *
 * 纯读-改-写核心：把路由数据合并进现有 pages.json 文本（多平台
 * `#ifdef` 块、首页重排、生成标记、子包收敛）并序列化。文件锁、
 * 变更检测与原子写入留在 {@link writePagesJson}；测试直接用纯字符串
 * 检验这个接口。
 *
 * @param existingContent - 当前 pages.json 文本，缺失时为空字符串
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
    // 把渲染好的 tabBar 主体拼接到占位符值上。使用函数形式的替换器：
    // 主体可能包含 `$` 序列，字符串替换器会把它们解释为替换模式
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

/** 从现有 pages.json 文本恢复出的一条 tabBar 原始属性 */
interface RawTabBarProp {
  key: string
  /** 保留内部注释的 comment-json 值；用于比较与重新序列化 */
  value: unknown
  /** 首个条件编译指令载荷（`#ifdef H5 || MP-WEIXIN` / `#ifndef MP-ALIPAY`），未包裹时为 null */
  condition: string | null
  /** 键之前 / 值之后的注释载荷，用于 #ifndef 的原样重发 */
  beforeComments: string[]
  afterComments: string[]
}

/**
 * 跳过空白与注释；行注释/块注释的载荷（标记之间的文本，去除首尾
 * 空白）在提供 `comments` 时会被收集进去
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
  // 裸字面量（数字 / true / false / null）：到下一个结构性分隔符结束
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
 * 文本方式扫描 pages.json 内容中的 tabBar 对象，收集每个顶层属性及
 * 其条件编译包裹层。
 *
 * comment-json 在解析时按普通 JS 对象语义折叠重复键，因此按平台区分
 * 的属性变体——互斥 `#ifdef` 块下的重复键——必须在解析破坏它们之前
 * 从原始文本恢复。不存在对象形态的 tabBar 或文档结构无法理解时返回
 * undefined。
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
  let lastRegistered: RawTabBarProp | undefined
  let i = skipJsoncFiller(content, interiorStart, beforeComments)

  while (true) {
    if (i >= content.length)
      return undefined
    if (content[i] === '}')
      return props
    if (content[i] === ',') {
      const postComma: string[] = []
      i = skipJsoncFiller(content, i + 1, postComma)
      // 包裹层的 #endif 行输出在值的逗号之后（comment-json 的风格），
      // 因此前导的 #endif 指令串闭合的是刚注册的属性；其余注释归入
      // 下一个属性的前置注释
      let split = 0
      while (split < postComma.length && postComma[split].startsWith('#endif'))
        split++
      if (lastRegistered)
        lastRegistered.afterComments.push(...postComma.slice(0, split))
      beforeComments = postComma.slice(split)
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

    try {
      const value = cjParse(rawValue)
      // 跳过游离的 #endif 行（手写包裹层的闭合符可能出现在下一个属性
      // 的开启符之前）；只有 #ifdef/#ifndef 会开启包裹层
      const condition = beforeComments.find(c => c.startsWith('#ifdef') || c.startsWith('#ifndef')) ?? null
      const raw: RawTabBarProp = { key, value, condition, beforeComments: [...beforeComments], afterComments }
      const variants = props.get(key) || []
      variants.push(raw)
      props.set(key, variants)
      lastRegistered = raw
    }
    catch {
      // 无法解析的值：丢弃该变体，本次运行会用自己的配置重写该属性
    }
  }
}

/** 一条已归属平台的 tabBar 属性变体（`list` 之外的一切） */
interface TabBarPropVariant {
  /** 归一化的比较形态：剥离注释后的值的 JSON.stringify */
  valueStr: string
  /** 保留内部注释的 comment-json 值，用于重新序列化 */
  value: unknown
  /** 拥有该变体的平台；null 表示原样透传的手写 `#ifndef` */
  platforms: string[] | null
  /** 原样透传重发所需的包裹层注释载荷 */
  passthrough: { before: string[], after: string[] } | null
}

/**
 * 跨平台合并 tabBar 外观属性（`list` 之外的一切），按属性复刻
 * {@link mergePlatformItems} 的归属语义：`#ifdef` 包裹的属性保留其
 * 列出的平台；未包裹的属性归属平台全集（当前平台之外）的所有平台
 * （本次运行重写自己的）；失去最后一个平台的变体收敛消失。手写的
 * `#ifndef` 属性原样透传且豁免收敛，与数组侧的策略一致。
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
      // 内容相等的 #ifndef 透传优先：当前平台不是被否定的平台时，
      // 透传已覆盖该属性；当前平台正是被否定的平台时，隐藏该属性
      // 尊重了手写的排除语义。两种情况下都不该再写入单独的变体
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

  return merged
}

/** 最终序列化的单级缩进单位 */
function indentUnitOf(format: PagesJsonFormatOptions | undefined): string {
  const indent = format?.indent ?? 2
  return typeof indent === 'number' ? ' '.repeat(indent) : indent
}

/** 缩进除首行外的每一行——多行值的内联续行 */
function indentContinuation(text: string, extra: string): string {
  return text.split('\n').map((line, index) => index === 0 ? line : extra + line).join('\n')
}

/**
 * 把 tabBar 外观属性渲染为完整缩进的输出行。覆盖平台全集的变体不
 * 包裹输出；其余每个变体获得自己的 `#ifdef` 块作为重复键，uni-app
 * 的按平台注释剥离会将其解析为单个值。
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

/** 把合并后的 tabBar list 渲染为完整缩进的输出行（始终是 tabBar 的最后一个属性） */
function renderTabBarListLines(list: CommentArray<CommentObject>, format: PagesJsonFormatOptions | undefined): string[] {
  const unit = indentUnitOf(format)
  const text = cjStringify(list, null, format?.indent ?? 2)
  return text.split('\n').map((line, index) => {
    if (index === 0)
      return `${unit}${unit}"list": ${line}`
    return line === '' ? line : unit + unit + line
  })
}

/** 解析 `||` 分隔的平台列表，去掉当前平台并把其余排序 */
function platformsExcluding(platformList: string, currentPlatform: string): string[] {
  return platformList.split('||').map(p => p.trim()).filter(p => p !== currentPlatform).sort()
}

/**
 * 条目可能携带内部 `type` 标记（'home' | 'page'），但它不得影响相等
 * 性：从 pages.json 合并而来的条目可能缺少该标记（手写条目从不携带
 * 它），直接用 JSON.stringify 比较会把同一页面当成两个不同条目，在
 * 跨平台运行中产出重复路由
 * （见 https://github.com/uni-helper/vite-plugin-uni-pages/issues/283）。
 * 序列化前先剥离 `type` 归一化两侧。
 */
function stringifyForCompare<T extends object>(val: T): string {
  if ('type' in val) {
    const { type: _type, ...rest } = val
    return JSON.stringify(rest)
  }
  return JSON.stringify(val)
}

/**
 * 两个内容相等的条目是否在首页状态上一致
 *
 * `type` 标记不参与内容比较（见 stringifyForCompare），无标记的条目
 * 仍能与扫描到的对应条目合并。但当两侧都显式携带标记且不一致
 * （'home' 与 'page'）时，它们描述的是各平台不同的首页，必须保持为
 * #ifdef 块后的独立条目，不能折叠进先写入的一方——折叠正是首页切换
 * 后陈旧首页标记残留、平台作用域首页声明被静默丢弃的原因。
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
   * 手写 `#ifndef` 块的原样透传载荷：插件的平台全集模型表达不了
   * 否定式可见性，因此该条目以原始前导注释（去掉生成标记，数组
   * 会重新生成它）加上合成的 `#endif` 闭合符重新输出——comment-json
   * 会把数组中间的闭合符（输出在值的逗号之后）挂到下一个条目的
   * 前置注释上，捕获到的闭合符无法可靠定位。该块解释为只包裹
   * 本条目。常规条目为 undefined。
   */
  passthrough?: { before: CommentToken[], after: CommentToken[] }
}

/**
 * 从 before:0 的生成标记读取上一次运行记录的平台，去掉当前平台
 */
function extractLastPlatforms(src: CommentArray<CommentObject>, currentPlatform: string): string[] {
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    // comment-json v5 在源文本包含空行时输出 BlankLine 令牌（不带
    // `value`），例如手工格式化的 pages.json 文件
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
 * 计算各合并变体记录的全部平台的有序并集
 *
 * 该并集是文件级的平台集合：它写入生成标记，并决定哪些变体可以不带
 * `#ifdef` 块输出。未包裹的条目在 uni-app 条件编译下对所有平台可见，
 * 因此只有覆盖整个并集的变体才能裸露输出。
 *
 * 当前平台始终加入并集，即使本次运行贡献零条目——例如主包页面只在
 * H5 存在，而 MP-WEIXIN 运行把每个页面都通过 definePage(null) 退出。
 * 只从幸存条目推导并集的话，它会停留在 'H5'，仅 H5 的变体看起来
 * 覆盖了整个并集而被裸露输出，泄漏进本平台的条件编译视图。（同场景
 * 下的子包由 mergeIntoPagesJson 整个丢弃，因为其构建产物没有目录
 * 对应空的 root。）之前以最常用组合为默认值的做法有同一类缺陷：
 * 它可能解析出单平台组合（主导的平台专属页面或使用并列），把该
 * 平台的变体裸露输出，作为重复路由泄漏进其他平台的视图。这个种子
 * 同样保护 tabBar 属性的包裹层：没有它，零 tabBar 的运行会看到
 * 拥有平台 == 并集，把外来拥有的 tabBar 裸露输出，恰好重新引入了
 * 包裹层要防止的泄漏
 *
 * 上一次运行生成标记记录的平台也加入并集。当某平台的全部包裹变体
 * 都被消费后，外来成员身份只能存活在标记里：拥有平台重新运行时，
 * 它自己的 #ifdef 变体被新扫描替换、从合并 map 中退出，仅靠条目
 * 推导的成员身份会震荡——外来运行后包裹，拥有运行后又裸露。吸收
 * 标记让并集在运行间单调；陈旧成员只会带来多余的包裹，从不会泄漏。
 *
 * 单调性的另一面：永久退役的平台（其 dev 终端再也不会运行）会一直
 * 留在标记里，让每个分叉条目保持包裹。这无害但永久——不要手工编辑
 * 标记行来清理；直接删除生成的 pages.json，让下次运行从头重新生成。
 */
/**
 * 收集各合并变体记录的全部平台
 *
 * {@link resolvePlatformUnion} 的无种子版本：并集种子（当前平台、
 * 标记平台）正是那个并集与这个集合的差异，这个集合同时也是区块的
 * 拥有平台集
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

/** {@link mergePlatformItems} 的结果：合并后的条目及其隐含的平台集合 */
interface MergedPlatformItems {
  /** 带 #ifdef 块与生成标记的合并配置条目 */
  items: CommentArray<CommentObject>
  /** 有序平台全集：当前平台、标记记录的上次平台与所有幸存变体的平台 */
  platformUnion: string[]
  /**
   * 拥有至少一个幸存变体的平台的有序并集。为整个区块限定可见性的
   * 调用方（如 tabBar 属性）只对这批平台展示；在这里推导归属让决策
   * 基于结构化数据，而不必重新解码输出的 `#ifdef` 注释。
   */
  owningPlatforms: string[]
}

/**
 * 合并多平台页面配置条目
 * 处理条件编译注释（#ifdef / #ifndef / #endif），把不同平台的配置条目合并进一个数组。
 * 相同的配置条目自动合并平台标识，不同的配置条目保留条件编译注释。
 * 手写的 `#ifndef` 块原样透传：否定式条件无法表达为正向平台列表，
 * 因此条目保留原始包裹层，平台成员身份永不增减、也永不收敛。
 *
 * @param source - 现有配置条目数组（来自 pages.json）
 * @param currentPlatform - 当前平台标识（如 H5、MP-WEIXIN）
 * @param items - 新配置条目数组
 * @param uniqueKeyName - 用于识别配置条目唯一性的字段名（如 'path' 或 'pagePath'）
 * @returns 带 #ifdef 块的合并条目，以及平台全集与拥有平台
 */
function mergePlatformItems<T extends object = Record<string, unknown>>(source: CommentArray<CommentObject> | undefined, currentPlatform: string, items: T[], uniqueKeyName: keyof ExcludeIndexSignature<T>): MergedPlatformItems {
  const src = source || new CommentArray<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. 从生成标记读取上一次运行记录的平台
  const lastPlatforms = extractLastPlatforms(src, currentPlatform)

  // 2. 遍历源数组，逐个判断元素，再以 uniqueKey 的元素值为键加入新的 mergedMap
  const mergedMap = new Map<string, MultiPlatformItem<T>[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as unknown as T
    const uniqueKey = (item as Record<string, unknown>)[uniqueKeyName as string] as string

    if (!uniqueKey) {
      continue
    }

    // 检查是否存在条件编译注释
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // BlankLine 令牌不带 `value`，匹配前必须跳过。显式匹配
    // #ifdef/#ifndef：comment-json 会把包裹层的闭合 #endif（输出在值
    // 的逗号之后）挂到下一个条目的前置注释上，绝不能把它当成开启符
    const conditionalComment = beforeComments?.find((c): c is CommentLineToken => c.type !== 'BlankLine' && /^#(?:ifdef|ifndef)/.test(c.value.trim()))

    // 手写的 `#ifndef` 块原样透传：否定式条件无法表达为正向平台
    // 列表，因此条目保留原始前导注释并豁免收敛（与文档承诺的
    // 「手写内容永不修改」一致）。插件自己从不输出 `#ifndef`，因此
    // 每个这样的块都出自用户之手。闭合符在输出时合成；滞留在后续
    // 条目前置注释里的游离 `#endif`（comment-json 把数组中间的闭合
    // 符挂到下一个条目上）被上面的指令匹配器跳过，并被全新包裹层的
    // 重建丢弃。
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

    // platforms 除当前平台外为空时跳过。
    // 注意：这也会丢弃既无生成标记又无 #ifdef 块的手写条目——当它们
    // 不在本次运行的扫描结果中时（其平台列表解析为空）。历史行为，
    // 原样保留；需要在每次运行中幸存的手写页面应放进 pages.config.ts
    // 的 `pages`，它会被无条件合并。
    if (platforms.length === 0) {
      continue
    }

    const existing = mergedMap.get(uniqueKey) || []
    existing.push({ item, itemStr: stringifyForCompare(item), platforms, platformStr: platforms.join(' || ') })
    mergedMap.set(uniqueKey, existing)
  }

  // 3. 把新条目合并进 mergedMap
  // 内部 `type` 标记按设计保留在扫描条目上（供后续运行中
  // ensureHomePageFirst 的首页兜底使用）；只有相等性比较会把它归一化
  // 掉（stringifyForCompare）
  for (const item of items) {
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey) {
      continue
    }

    if (!mergedMap.has(uniqueKey)) {
      // 不存在时直接加入 mergedMap
      mergedMap.set(uniqueKey, [{
        item,
        itemStr: stringifyForCompare(item),
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      }])
      continue
    }

    // 已存在时检查条目是否相等
    const existing = mergedMap.get(uniqueKey)!

    const itemStr = stringifyForCompare(item)
    // 优先折叠进内容相等的 `#ifndef` 透传：当前平台不是被否定的
    // 平台时，透传已经覆盖它；当前平台正是被否定的平台时，隐藏
    // 扫描条目尊重了手写的排除语义。无论哪种情况，单独的扫描变体
    // 都会输出重复路由或覆盖用户的条件
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

  // 只有覆盖平台全集的变体才能不带 #ifdef 块输出：未包裹的条目对
  // 所有平台可见，较窄的变体必须保持包裹，以保证其他平台的视图干净。
  // resolvePlatformUnion 总是给并集播种当前平台与标记记录的上次
  // 平台，因此零贡献的运行也会迫使外来变体保持包裹，早先运行记录的
  // 外来成员身份也能在拥有平台重跑后幸存
  const platformUnion = resolvePlatformUnion(mergedMap, currentPlatform, lastPlatforms)
  const platformUnionStr = platformUnion.join(' || ')

  // 平台拥有该区块当且仅当它拥有至少一个幸存变体；裸变体按构造覆盖
  // 整个并集，因此变体平台集的普通并集就是拥有集
  const owningPlatforms = collectVariantPlatforms(mergedMap)

  // 把生成标识注释加入 result 的 Symbol.for(`before:0`)
  result[Symbol.for('before:0') as CommentSymbol] = [lineComment(` ${GENERATION_MARKER_PREFIX} ${platformUnionStr}`)]

  // 按插入顺序处理元素
  for (const [_, list] of mergedMap) {
    for (const { item, platformStr, passthrough } of list) {
      result.push(item as unknown as CommentObject)

      // 手写 #ifndef 块：原样重发原始包裹层
      // （存储的令牌已包含 #ifndef 与 #endif 行）
      if (passthrough) {
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [
          ...(result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] || []),
          ...passthrough.before,
        ]
        if (passthrough.after.length > 0)
          result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = passthrough.after
        continue
      }

      // 检查变体是否覆盖平台全集（两个字符串都已排序）
      if (platformStr !== platformUnionStr) {
        // 变体只覆盖平台的子集：包裹它，让其他平台的条件编译视图
        // 跳过它。追加而非替换：before:0 可能已携带生成标记，
        // 它必须保持在数组顶部
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
