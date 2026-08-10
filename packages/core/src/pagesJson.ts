import type { CommentLineToken, CommentObject, CommentSymbol } from 'comment-json'
import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from './config'
import type { ExcludeIndexSignature, InternalPageItem, InternalPages } from './types'
import fs from 'node:fs'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import writeFileAtomic from 'write-file-atomic'
import { withFileLock } from './files'
import { debug } from './logger'

/**
 * pages.json read-modify-write module
 *
 * Deep module owning everything pages.json-specific: multi-platform #ifdef
 * merging, home page reordering with comment attachment surgery, generation
 * marker handling, serialization formatting, file locking and atomic writes.
 * Callers only see {@link writePagesJson}; comment-json internals never leak
 * past its interface.
 */

/** Route data assembled by the scan/merge pipeline */
export interface PagesJsonData {
  /** Main package page metadata */
  pages: InternalPages
  /** Sub-package page metadata */
  subPackages: SubPackages
  /** Resolved tabBar configuration */
  tabBar?: TabBar
  /**
   * Path of the home page resolved from scanned metadata. Merged entries keep
   * the object read from pages.json (no internal `type` marker), so the home
   * entry is repositioned by path; falls back to the `type` marker when unset.
   */
  homePath?: string
}

/** Serialization options for the generated pages.json */
export interface PagesJsonFormatOptions {
  /** Minify the output, takes precedence over `indent` */
  minify?: boolean
  /** Indentation, number of spaces or string (e.g. '\t') */
  indent?: number | string
  /** Line ending */
  eol?: '\n' | '\r\n'
  /** Whether to insert a final newline */
  insertFinalNewline?: boolean
}

export interface WritePagesJsonOptions {
  /** Current platform identifier, e.g. 'mp-weixin' or 'h5' */
  platform: string
  /** User config from pages.config.ts; fields other than pages/subPackages/tabBar pass through to the output */
  globConfig?: PagesConfig
  /** Serialization format */
  format?: PagesJsonFormatOptions
  /**
   * Content written by the previous run; the write is skipped when unchanged.
   * Accepts a getter so overlapping in-process updates evaluate the latest
   * value inside the lock instead of a snapshot taken before acquiring it.
   */
  previousContent?: string | (() => string | undefined)
}

/**
 * Merge the given route data into pages.json and write it back
 *
 * The whole read-modify-write runs inside one file lock: the new content
 * depends on the current content (other platforms' `#ifdef` blocks), so
 * concurrent terminals (e.g. dev:mp-weixin + dev:mp-alipay) must not observe
 * or overwrite each other's half-written state. The write is atomic
 * (tmp + rename) so a crash mid-write cannot leave a truncated file.
 *
 * @param jsonPath - pages.json file path
 * @param data - Route data assembled by the scan/merge pipeline
 * @param options - Platform, user config, format and change-detection options
 * @returns Write result, or undefined if the file lock could not be acquired
 */
export async function writePagesJson(jsonPath: string, data: PagesJsonData, options: WritePagesJsonOptions): Promise<{ updated: boolean, content: string } | undefined> {
  return withFileLock(jsonPath, async () => {
    const existingContent = await fs.promises.readFile(jsonPath, { encoding: 'utf-8' }).catch(() => '')

    const pageJson = mergeIntoPagesJson(existingContent, data, options)

    const minify = options.format?.minify ?? false
    const indent = options.format?.indent ?? 2
    const eol = options.format?.eol ?? '\n'
    let content = cjStringify(pageJson, null, minify ? undefined : indent)
    if (eol !== '\n')
      content = content.replaceAll('\n', eol)

    if (options.format?.insertFinalNewline)
      content += eol

    const previousContent = typeof options.previousContent === 'function'
      ? options.previousContent()
      : options.previousContent

    if ((previousContent ?? '') === content) {
      debug.pages('PagesJson Not have change')
      return { updated: false, content }
    }

    await writeFileAtomic(jsonPath, content)
    return { updated: true, content }
  })
}

/**
 * Compute the merged pages.json object from the existing file content
 */
function mergeIntoPagesJson(existingContent: string, data: PagesJsonData, options: Pick<WritePagesJsonOptions, 'platform' | 'globConfig'>): PagesConfig {
  const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = cjParse(existingContent || '{}') as CommentObject

  const { pages: _pages, subPackages: _subPackages, tabBar: _tabBar, ...pageJson } = options.globConfig || {}

  const currentPlatform = options.platform.toUpperCase()

  // pages
  const oldPagesArray = oldPages as unknown as CommentArray<CommentObject> | undefined
  pageJson.pages = mergePlatformItems(oldPagesArray, currentPlatform, data.pages, 'path') as unknown as Pages

  // mergePlatformItems uses a Map internally which may lose the ordering from setHomePage,
  // so we need to ensure the home page is placed first after the merge
  ensureHomePageFirst(pageJson.pages as unknown as InternalPages | undefined, data.homePath)

  // subPackages
  pageJson.subPackages = oldSubPackages || new CommentArray<CommentObject>()
  const newSubPackages = new Map<string, SubPackage>()
  for (const item of data.subPackages) {
    newSubPackages.set(item.root, item)
  }
  // Update existing sub-packages in pages.json with new metadata
  for (const existing of pageJson.subPackages as unknown as SubPackage[]) {
    const sub = newSubPackages.get(existing.root)
    if (sub) {
      existing.pages = mergePlatformItems(existing.pages as unknown as CommentArray<CommentObject>, currentPlatform, sub.pages, 'path') as unknown as Pages
      // Preserve plugins property from user config
      if (sub.plugins) {
        existing.plugins = sub.plugins
      }
      newSubPackages.delete(existing.root)
    }
  }
  // Add new sub-packages that don't exist in pages.json yet
  for (const [_, newSub] of newSubPackages) {
    const subPackage: SubPackage = {
      root: newSub.root,
      pages: mergePlatformItems(undefined, currentPlatform, newSub.pages, 'path') as unknown as Pages,
    }
    // Include plugins property if configured
    if (newSub.plugins) {
      subPackage.plugins = newSub.plugins
    }
    (pageJson.subPackages as unknown as SubPackage[]).push(subPackage)
  }

  // tabbar
  const { list, ...tabBarOthers } = data.tabBar || {}
  if (list) {
    const oldTabBarObj = oldTabBar as unknown as { list?: CommentArray<CommentObject> } | undefined
    const { list: oldList } = oldTabBarObj || {}
    const newList = mergePlatformItems(oldList, currentPlatform, list, 'pagePath')
    pageJson.tabBar = {
      ...tabBarOthers, // Always update properties other than list directly
      list: newList,
    }
  }
  else {
    pageJson.tabBar = undefined // Clear directly, currently not supporting platform A having tabBar while platform B does not
  }

  return pageJson as PagesConfig
}

/**
 * Move the home page entry to the first position while keeping its comment
 * attachment intact
 */
function ensureHomePageFirst(pagesArray: InternalPages | undefined, homePath: string | undefined): void {
  if (!pagesArray || pagesArray.length === 0)
    return

  // Merged entries keep the object from pages.json, which has no internal
  // `type` marker, so resolve the home page path from the scanned metadata
  // and match by path; fall back to the `type` marker for type-bearing items
  const homeIndex = homePath
    ? pagesArray.findIndex((page: InternalPageItem) => page.path === homePath)
    : pagesArray.findIndex((page: InternalPageItem) => page.type === 'home')
  if (homeIndex <= 0)
    return

  // `CommentArray#splice`/`unshift` only re-index the surviving elements'
  // comments: the removed entry's comments stay stranded at its old index
  // and get attached to whatever element moves into that slot, misplacing
  // `#ifdef`/`#endif` blocks and the generation marker. Snapshot the home
  // entry's comments, drop the stranded ones, then re-attach them at 0.
  const commentArray = pagesArray as unknown as CommentArray<CommentObject>
  const homeBefore = commentArray[Symbol.for(`before:${homeIndex}`) as CommentSymbol]
  const homeAfter = commentArray[Symbol.for(`after:${homeIndex}`) as CommentSymbol]
  // before:0 mixes the generation marker with the previous first entry's
  // own comments (e.g. its #ifdef block): keep the marker on top and
  // leave the entry's comments attached to it at its new index 1
  const firstBefore = commentArray[Symbol.for('before:0') as CommentSymbol] || []
  const isMarker = (token: CommentLineToken | { type: string, value?: string }): boolean =>
    token.type !== 'BlankLine' && typeof token.value === 'string' && token.value.trim().startsWith('GENERATED BY UNI-PAGES, PLATFORM:')
  const markerTokens = firstBefore.filter(isMarker)
  const firstEntryTokens = firstBefore.filter(token => !isMarker(token))

  // Drop home's own comment symbols BEFORE splicing: comment-json then
  // shifts every following element's comments down into the freed slot,
  // so deleting `before/after:${homeIndex}` afterwards would destroy the
  // comments of the element that moved into that position. `before:0`
  // must also be gone before the unshift re-indexes everything by +1.
  Reflect.deleteProperty(commentArray, Symbol.for(`before:${homeIndex}`))
  Reflect.deleteProperty(commentArray, Symbol.for(`after:${homeIndex}`))
  Reflect.deleteProperty(commentArray, Symbol.for('before:0'))
  const [homePage] = pagesArray.splice(homeIndex, 1)
  pagesArray.unshift(homePage)

  commentArray[Symbol.for('before:0') as CommentSymbol] = [...markerTokens, ...(homeBefore || [])]
  if (firstEntryTokens.length > 0) {
    commentArray[Symbol.for('before:1') as CommentSymbol] = firstEntryTokens
  }
  if (homeAfter) {
    commentArray[Symbol.for('after:0') as CommentSymbol] = homeAfter
  }
}

/**
 * Merge multi-platform page configuration items
 * Handle conditional compilation comments (#ifdef / #endif), merge configuration items from different platforms into one array
 * Same configuration items will automatically merge platform identifiers, different configuration items will keep conditional compilation comments
 *
 * @param source - Existing configuration item array (from pages.json)
 * @param currentPlatform - Current platform identifier (e.g. H5, MP-WEIXIN)
 * @param items - New configuration item array
 * @param uniqueKeyName - Field name used to identify configuration item uniqueness (e.g. 'path' or 'pagePath')
 * @returns Merged configuration item array with conditional compilation comments
 */
function mergePlatformItems<T extends object = Record<string, unknown>>(source: CommentArray<CommentObject> | undefined, currentPlatform: string, items: T[], uniqueKeyName: keyof ExcludeIndexSignature<T>): CommentArray<CommentObject> {
  const src = source || new CommentArray<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. Extract the first comment from CommentArray and get platforms as lastPlatforms
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    // comment-json v5 emits BlankLine tokens (without `value`) when the source
    // contains blank lines, e.g. manually formatted pages.json files
    if (comment.type === 'BlankLine')
      continue

    const trimmed = comment.value.trim()
    if (trimmed.startsWith('GENERATED BY UNI-PAGES, PLATFORM:')) {
      // Remove current platform
      lastPlatforms = trimmed.split(':')[1].split('||').map(s => s.trim()).filter(s => s !== currentPlatform).sort()
    }
  }

  // Items may carry an internal `type` marker ('home' | 'page'), but it must not
  // affect equality: pages.json files written by older versions may have `type`
  // stripped, so a raw JSON.stringify comparison would treat the same page as two
  // different entries and produce duplicate routes across platform runs
  // (see https://github.com/uni-helper/vite-plugin-uni-pages/issues/283).
  // stringifyForCompare normalizes both sides by dropping `type` before serializing.
  const stringifyForCompare = (val: T): string => {
    if (val && typeof val === 'object' && 'type' in val) {
      const { type: _type, ...rest } = val
      return JSON.stringify(rest)
    }
    return JSON.stringify(val)
  }

  // 2. Iterate source, judge each element, then add to new mergedMap using uniqueKey element value as key
  interface MultiPlatformItem {
    item: T
    itemStr: string
    platforms: string[]
    platformStr: string
  }
  const mergedMap = new Map<string, MultiPlatformItem[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as unknown as T
    const uniqueKey = (item as Record<string, unknown>)[uniqueKeyName as string] as string

    if (!uniqueKey) {
      continue
    }

    // Check if there are conditional compilation comments
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // const afterComments = src[Symbol.for(`after:${i}`) as CommentSymbol]

    // BlankLine tokens carry no `value` and must be skipped before matching
    const ifdefComment = beforeComments?.find((c): c is CommentLineToken => c.type !== 'BlankLine' && c.value.trim().startsWith('#ifdef'))
    // const endifComment = afterComments?.find(c => c.value.trim().startsWith('#endif'))

    let platforms: string[] = [...lastPlatforms]

    if (ifdefComment) {
      const match = ifdefComment.value.match(/#ifdef\s+(.+)/)
      if (match) {
        // Remove current platform
        platforms = match[1].split('||').map(p => p.trim()).filter(s => s !== currentPlatform).sort()
      }
    }

    // Skip if platforms is empty except for current platform
    if (platforms.length === 0) {
      continue
    }

    const existing = mergedMap.get(uniqueKey) || []
    existing.push({ item, itemStr: stringifyForCompare(item), platforms, platformStr: platforms.join(' || ') })
    mergedMap.set(uniqueKey, existing)
  }

  // 3. Merge items into mergedMap
  for (const item of items) {
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey) {
      continue
    }

    if (!mergedMap.has(uniqueKey)) {
      // If not exists, add to mergedMap
      mergedMap.set(uniqueKey, [{
        item,
        itemStr: stringifyForCompare(item),
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      }])
      continue
    }

    // If exists, check if elements are equal
    const existing = mergedMap.get(uniqueKey)!

    const itemStr = stringifyForCompare(item)
    const equalObj = existing.find(val => val.itemStr === itemStr)
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

  // 4. Iterate mergedMap to generate result:CommentArray<CommentObject>
  const result = new CommentArray<CommentObject>()

  // Check platform usage frequency, use the most frequently used platform as default
  const platformUsage: Record<string, number> = {}
  mergedMap.forEach((val) => {
    Object.values(val).forEach((v) => {
      platformUsage[v.platformStr] = (platformUsage[v.platformStr] || 0) + 1
    })
  })
  const usageKeys = Object.keys(platformUsage).sort()
  const defaultPlatformStr = usageKeys.length
    // Sort the keys so the tie-break is deterministic instead of depending on
    // map insertion order: the home reordering above changes that order
    // between runs, which used to flip the default platform back and forth
    // until the output converged
    ? usageKeys.reduce((a, b) => (platformUsage[a] > platformUsage[b] ? a : b))
    : currentPlatform

  // Add generation identifier comment to result's Symbol.for(`before:0`)
  result[Symbol.for('before:0') as CommentSymbol] = [{
    type: 'LineComment',
    value: ` GENERATED BY UNI-PAGES, PLATFORM: ${defaultPlatformStr}`,
    inline: false,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }]

  // Process elements in insertion order
  for (const [_, list] of mergedMap) {
    for (const { item, platformStr } of list) {
      result.push(item as unknown as CommentObject)

      // Check if platforms matches defaultPlatformStr (platforms and defaultPlatforms are pre-sorted)
      if (platformStr !== defaultPlatformStr) {
      // Platform info exists and differs from default platform, add conditional compilation comments
        // Append instead of replacing: before:0 may already carry the
        // generation marker, which must stay at the top of the array
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [
          ...(result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] || []),
          {
            type: 'LineComment',
            value: ` #ifdef ${platformStr}`,
            inline: false,
            loc: {
              start: { line: 0, column: 0 },
              end: { line: 0, column: 0 },
            },
          },
        ]

        result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = [{
          type: 'LineComment',
          value: ' #endif',
          inline: false,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        }]
      }
    }
  }

  // 5. Return result:CommentArray<CommentObject>
  return result
}
