import { parse as cjParse } from 'comment-json'

/**
 * JSONC 文本扫描：从 pages.json 的原始文本里捞回 comment-json 解析时
 * 丢掉的信息
 *
 * comment-json 按普通 JS 对象规则解析，同一个键出现多次只留最后一个；
 * 而 tabBar 的「同一个属性按平台写多个值」（每个值包在自己的 #ifdef
 * 里）靠的就是重复键。这些信息一旦解析就丢了，所以 tabBar 属性的提
 * 取（tab-bar.ts）不喂 comment-json 的解析结果，而是喂这里按文本扫
 * 描出来的原始属性。pages.json 不是对象、或结构看不懂时安全退回
 * undefined，调用方用自己的配置重写。
 */

/** 从现有 pages.json 文本里提取出来的一条 tabBar 属性 */
export interface RawTabBarProp {
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
export function extractTabBarProps(content: string): Map<string, RawTabBarProp[]> | undefined {
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
