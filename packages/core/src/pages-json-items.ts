import type { CommentArray, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
import type { PlatformVariant } from './platform-variants'
import type { ExcludeIndexSignature, InternalPageItem } from './types'
import { CommentArray as CommentArrayValue } from 'comment-json'
import { findConditionalComment, lineComment, sanitizePassthroughComments } from './pages-json-tokens'
import {
  collectVariantPlatforms,
  extractLastPlatforms,
  GENERATION_MARKER_PREFIX,
  orderVariantLists,
  platformsExcluding,
  resolvePlatformUnion,
  sortVariants,
  upsertCurrentVariant,
} from './platform-variants'

/**
 * 把条目转成字符串用于比较，比较前先拿掉内部的 `type` 标记。
 *
 * 从 pages.json 读回来的条目可能没有这个标记（手写条目从不带它），
 * 直接 JSON.stringify 会把同一个页面当成两个不同的条目，多平台运行时
 * 就会生成重复路由（见 https://github.com/uni-helper/vite-plugin-uni-pages/issues/283）。
 *
 * 键的顺序也参与比较（JSON.stringify 按写入顺序输出）：同一页面在两个
 * 平台下键序不同时不会被合并，会各占一个 #ifdef 块留在文件里。代价只是
 * 多一份内容相同的变体，构建时每个平台仍只看自己那一条。
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
 * `type` 标记不参与内容比较，没有标记的条目也能和扫描到的条目合并。
 * 但如果两边都明确带着标记、而且一个是 'home' 一个是 'page'，说明这是
 * 两个平台各自声明的不同首页，必须留在各自的 #ifdef 块里。
 */
function homeStatusCompatible(a: object, b: object): boolean {
  const typeA = (a as InternalPageItem).type
  const typeB = (b as InternalPageItem).type
  return typeA === undefined || typeB === undefined || typeA === typeB
}

/** 一条合并后的条目及其出现的平台（数组侧的变体形状） */
export interface MultiPlatformItem<T extends object> extends PlatformVariant<T> {
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
export interface MergedPlatformItems {
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

/** {@link mergePlatformItems} 的输出顺序选项 */
export interface MergePlatformItemsOptions {
  /**
   * 按配置顺序摆放条目（规则 6）：配置覆盖全部既有键时整体重排；
   * 未覆盖时只把新增键插到声明位置，既有键保持磁盘序。
   * 只有 tabBar list 启用，tab 顺序用户直接可见，pages 数组由
   * 首页前置子系统接管（各平台可声明不同首页，配置序重排会翻转
   * 首页变体的相对顺序）
   */
  orderByConfig?: boolean
}

/**
 * 合并多平台的配置条目（数组侧适配器）。
 *
 * 处理条件编译注释（#ifdef / #ifndef / #endif），把 pages.json 里
 * 已有的条目和本轮扫描的条目合并成一个数组；合并规则（同值叠平台、
 * 排除当前平台、排序、并集）用 platform-variants.ts 的共享核心。
 *
 * @param source - 现有条目数组（来自 pages.json）
 * @param currentPlatform - 当前平台标识（如 H5、MP-WEIXIN）
 * @param items - 新配置条目数组
 * @param uniqueKeyName - 用于识别条目唯一性的字段名（如 'path' 或 'pagePath'）
 * @param options - 输出顺序选项，见 {@link MergePlatformItemsOptions}
 * @returns 带 #ifdef 块的合并条目，以及平台全集与拥有平台
 */
export function mergePlatformItems<T extends object = Record<string, unknown>>(source: CommentArray<CommentObject> | undefined, currentPlatform: string, items: T[], uniqueKeyName: keyof ExcludeIndexSignature<T>, options: MergePlatformItemsOptions = {}): MergedPlatformItems {
  const { orderByConfig = false } = options
  const src = source || new CommentArrayValue<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. 从生成标记读取上一次运行记录的平台
  const lastPlatforms = extractLastPlatforms(src, currentPlatform)

  // 2. 遍历现有数组，逐个判断，以 uniqueKey 的值为键放进 mergedMap
  const mergedMap = new Map<string, MultiPlatformItem<T>[]>()
  // 磁盘上出现过的键及首次出现顺序，包括马上会被当前平台替换的旧条目。
  // 判断“新增键”必须用它而不是合并后的 map：只属于当前平台的旧条目在
  // 下面会被跳过，之后又被当前配置加回来，但它不是新增条目，不能跟着
  // 配置挪位置
  const sourceOrder = orderByConfig ? { seen: new Set<string>(), order: [] as string[] } : undefined
  const variantsOf = (uniqueKey: string): MultiPlatformItem<T>[] => {
    const list = mergedMap.get(uniqueKey) || []
    mergedMap.set(uniqueKey, list)
    return list
  }

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as unknown as T
    const uniqueKey = (item as Record<string, unknown>)[uniqueKeyName as string] as string

    if (!uniqueKey)
      continue
    if (sourceOrder && !sourceOrder.seen.has(uniqueKey)) {
      sourceOrder.seen.add(uniqueKey)
      sourceOrder.order.push(uniqueKey)
    }

    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    const conditionalComment = findConditionalComment(beforeComments)

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
          before: sanitizePassthroughComments(beforeComments, conditionalComment),
          after: [lineComment(' #endif')],
        },
      })
      continue
    }

    let platforms: string[] = [...lastPlatforms]

    if (conditionalComment) {
      const match = conditionalComment.value.match(/#ifdef\s+(.+)/)
      if (match)
        platforms = platformsExcluding(match[1], currentPlatform)
    }

    // 剩下的平台只有当前平台自己（或为空）时，跳过这个条目：
    // 本轮会写出自己的版本。
    // 注意：没有生成标记、也没包 #ifdef 的手写条目也会在这里被丢掉
    // （当它不在本轮扫描结果里时，解析出的平台列表是空的）。这是
    // 一直以来的行为，保持不变；想每次运行都保留的手写页面，请写进
    // pages.config.ts 的 `pages`，它会无条件合并进来
    if (platforms.length === 0)
      continue

    variantsOf(uniqueKey).push({ payload: item, valueStr: stringifyForCompare(item), platforms, platformStr: platforms.join(' || ') })
  }

  // 记下磁盘上已有键的顺序：部分覆盖时只给真正新增的键落位，既有
  // 键保持磁盘序（规则 6）
  const orderOptions = sourceOrder ? { diskOrder: sourceOrder.order } : undefined

  // 3. 把本轮扫描的条目合并进 mergedMap
  // 扫描条目上的 `type` 标记按设计保留（后面运行里 ensureHomePageFirst
  // 找首页要用它）；只有比较两条配置相不相等时才把它拿掉
  for (const item of items) {
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey)
      continue

    // 规则见 platform-variants 的 upsertCurrentVariant：同值叠平台、
    // 同值 #ifndef 优先；compatible 用来区分两个平台各自声明的不同
    // 首页（homeStatusCompatible）
    upsertCurrentVariant(variantsOf(uniqueKey), item, stringifyForCompare(item), currentPlatform, homeStatusCompatible)
  }

  // 4. 遍历 mergedMap 生成结果：CommentArray<CommentObject>
  const result = new CommentArrayValue<CommentObject>()

  // 输出前按平台列表把每个键的变体排好序（规则见 platform-variants
  // 的 sortVariants）：当前平台的变体在步骤 2 里被丢掉、步骤 3 里又
  // 补到列表末尾，两个平台轮流运行（dev:h5 和 dev:mp-weixin 交替
  // 写）时，同一键的变体顺序就会来回翻转
  for (const variants of mergedMap.values())
    sortVariants(variants)

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

  // 计算输出顺序：只有 tabBar list 启用配置序摆放（orderByConfig 由
  // 调用方决定）。配置覆盖全部既有键时整体重排；否则只把新增的
  // 键插到声明位置，既有键保持磁盘序（规则见 platform-variants 的
  // orderVariantLists）
  const declaredKeys = orderByConfig
    ? items.map(item => item[uniqueKeyName] as unknown).filter((key): key is string => typeof key === 'string' && key.length > 0)
    : null

  // 按输出顺序处理元素
  for (const list of orderVariantLists(mergedMap, declaredKeys, orderOptions)) {
    for (const { payload: item, platformStr, passthrough } of list) {
      result.push(item as unknown as CommentObject)

      // 手写 #ifndef 块：把原始包裹注释原样放回去
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
