import type { CommentArray, CommentObject } from 'comment-json'
import type { PagesJsonFormatOptions } from './pages-json'
import type { PlatformVariant } from './platform-variants'
import { stringify as cjStringify } from 'comment-json'
import { extractTabBarProps } from './jsonc-scan'
import { platformsExcluding, sortVariants, upsertCurrentVariant } from './platform-variants'

/**
 * tabBar 外观属性的跨平台合并与渲染（`list` 以外的所有属性）
 *
 * 对象侧适配器：属性变体从 pages.json 的原始文本里提取（重复键，
 * 见 jsonc-scan.ts），合并规则用 platform-variants.ts 的共享核心，
 * 渲染绕开 comment-json 手工拼行——comment-json 的对象表达不了
 * 「同一个键出现多次」，序列化时占位符替换发生在 pages-json.ts 的
 * mergePagesJson 里。
 */

/**
 * 一条已经分好平台的 tabBar 属性变体（`list` 以外的所有属性）；
 * payload 是原始的 comment-json 值（保留内部注释），重新序列化时用
 */
interface TabBarPropVariant extends PlatformVariant<unknown> {
  /** 手写 #ifndef 属性原样保留时需要的包裹注释 */
  passthrough: { before: string[], after: string[] } | null
}

/**
 * 跨平台合并 tabBar 的外观属性（`list` 以外的所有属性）。
 * 规则见 platform-variants.ts（和数组侧的 mergePlatformItems 共用）：
 * - 包在 #ifdef 里的属性，属于注释里列出的那些平台
 * - 没包裹的属性，属于除当前平台外的所有平台（当前平台会写自己的）
 * - 一个值最后一个平台都不剩了，就删掉它
 * - 手写的 #ifndef 属性原样保留、永不删除，和数组侧的处理一致
 */
export function mergeTabBarProps(
  existingContent: string,
  currentProps: Record<string, unknown>,
  contributesProps: boolean,
  currentPlatform: string,
  platformUnion: string[],
): Map<string, TabBarPropVariant[]> {
  const rawProps = extractTabBarProps(existingContent)
  const merged = new Map<string, TabBarPropVariant[]>()
  // 取这个键的变体列表，没有就建一个并注册进 merged
  const variantsOf = (key: string): TabBarPropVariant[] => {
    const list = merged.get(key) || []
    merged.set(key, list)
    return list
  }

  for (const [key, variants] of rawProps || []) {
    if (key === 'list')
      continue
    for (const raw of variants) {
      const valueStr = JSON.stringify(raw.value)
      if (valueStr === undefined)
        continue
      if (raw.condition?.startsWith('#ifndef')) {
        variantsOf(key).push({ payload: raw.value, valueStr, platforms: null, platformStr: '', passthrough: { before: raw.beforeComments, after: raw.afterComments } })
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
      variantsOf(key).push({ payload: raw.value, valueStr, platforms, platformStr: platforms.join(' || '), passthrough: null })
    }
  }

  if (contributesProps) {
    for (const [key, value] of Object.entries(currentProps)) {
      const valueStr = JSON.stringify(value)
      if (valueStr === undefined)
        continue
      upsertCurrentVariant(variantsOf(key), value, valueStr, currentPlatform)
    }
  }

  // 规则见 platform-variants 的 sortVariants：#ifndef 属性（空
  // platformStr）排最前，文档承诺的"当前平台自己的值排在后面、优先
  // 生效"在与 #ifndef 重复键的场景下依然成立
  for (const variants of merged.values()) {
    sortVariants(variants)
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
export function renderTabBarPropLines(merged: Map<string, TabBarPropVariant[]>, platformUnion: string[], format: PagesJsonFormatOptions | undefined): string[] {
  const unit = indentUnitOf(format)
  const unionStr = platformUnion.join(' || ')
  const lines: string[] = []

  for (const [key, variants] of merged) {
    for (const variant of variants) {
      const valueText = indentContinuation(cjStringify(variant.payload, null, format?.indent ?? 2), unit + unit)
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
      if (variant.platformStr === unionStr) {
        lines.push(propLine)
      }
      else {
        lines.push(`${unit}${unit}// #ifdef ${variant.platformStr}`)
        lines.push(propLine)
        lines.push(`${unit}${unit}// #endif`)
      }
    }
  }
  return lines
}

/** 把合并后的 tabBar list 渲染成带缩进的输出行（list 总是 tabBar 的最后一个属性） */
export function renderTabBarListLines(list: CommentArray<CommentObject>, format: PagesJsonFormatOptions | undefined): string[] {
  const unit = indentUnitOf(format)
  const text = cjStringify(list, null, format?.indent ?? 2)
  return text.split('\n').map((line, index) => {
    if (index === 0)
      return `${unit}${unit}"list": ${line}`
    return line === '' ? line : unit + unit + line
  })
}
