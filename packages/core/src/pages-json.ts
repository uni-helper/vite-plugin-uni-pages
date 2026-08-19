import type { Pages, PagesConfig, SubPackage, SubPackages, TabBar } from '@uni-helper/uni-pages-types'
import type { CommentLineToken, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
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
 * Callers see {@link writePagesJson} and the pure {@link mergePagesJson};
 * comment-json internals never leak past their interface.
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
   * Path of the home page resolved from scanned metadata. Entries merged
   * from pages.json may lack the internal `type` marker (user-written
   * entries never carry it), so the home entry is primarily repositioned
   * by path; falls back to the `type` marker when unset.
   */
  homePath?: string
}

/** Serialization options for the generated pages.json */
export interface PagesJsonFormatOptions {
  /**
   * Minify the output, takes precedence over `indent`. Single-line JSON
   * cannot carry comments, so the generation marker and any user comments
   * are dropped — multi-platform tracking then restarts from scratch on the
   * next run
   */
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

/** Options for the pure merge step: everything of {@link WritePagesJsonOptions} except file-level concerns */
export type MergePagesJsonOptions = Pick<WritePagesJsonOptions, 'platform' | 'globConfig' | 'format'>

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

    const content = mergePagesJson(existingContent, data, options)

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
  const subPackagesArray = pageJson.subPackages as unknown as CommentArray<CommentObject>
  const staleRoots: string[] = []
  for (const existing of subPackagesArray as unknown as SubPackage[]) {
    const sub = newSubPackages.get(existing.root)
    if (sub) {
      existing.pages = mergePlatformItems(existing.pages as unknown as CommentArray<CommentObject>, currentPlatform, sub.pages, 'path') as unknown as Pages
      // Preserve plugins property from user config
      if (sub.plugins) {
        existing.plugins = sub.plugins
      }
      newSubPackages.delete(existing.root)
    }
    else if (hasGenerationMarker(existing.pages as unknown as CommentArray<CommentObject> | undefined)) {
      // Plugin-generated sub-package missing from this run's scan (every page
      // opted out via definePage(null) or the directory was removed): converge
      // it like the main package — strip the current platform's entries while
      // keeping other platforms' #ifdef blocks. User-written sub-packages
      // carry no generation marker and stay untouched.
      const converged = mergePlatformItems(existing.pages as unknown as CommentArray<CommentObject>, currentPlatform, [] as Pages, 'path')
      if (converged.length > 0) {
        existing.pages = converged as unknown as Pages
      }
      else {
        staleRoots.push(existing.root)
      }
    }
  }
  // Drop plugin-generated sub-packages whose pages converged to nothing on
  // every remaining platform. Iterate backwards and drop the entry's comment
  // symbols BEFORE splicing, mirroring ensureHomePageFirst: comment-json then
  // shifts the following elements' comments into the freed slot, so the
  // neighbours' #ifdef blocks survive the removal. `after-value:i` (a user
  // comment between the entry's `}` and `,`) must be dropped too — splice
  // only moves surviving elements' comments, so it would otherwise leak onto
  // whatever entry shifts into this slot.
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
 * Move every home page entry to the front while keeping comment attachment
 * intact
 *
 * Each platform may declare its own home behind #ifdef blocks, and an
 * unwrapped entry is visible to every platform. The home of a platform must
 * therefore precede every entry visible to that platform; placing all home
 * variants before every non-home entry (stable partition) satisfies that for
 * every platform view at once. Moving only the current platform's home is
 * not enough: once its home already sits at index 0, another platform's home
 * stays stranded behind a non-home entry that platform can see.
 *
 * The guarantee covers entries carrying the internal `type` marker (every
 * scanned entry does) plus every unmarked variant of the resolved homePath
 * via the fallback below; the marker itself is never restored on the merged
 * objects, so the fallback re-derives home status from homePath each run.
 */
function ensureHomePageFirst(pagesArray: InternalPages | undefined, homePath: string | undefined): void {
  if (!pagesArray || pagesArray.length === 0)
    return

  // Entries merged from pages.json may lack the internal `type` marker
  // (user-written entries never carry it), so fall back to the path resolved
  // from scanned metadata when no variant of it carries the home marker.
  // Scanned entries always carry the marker, so `type === 'home'` alone
  // already collects every platform's home variant.
  const isHome = pagesArray.map((page: InternalPageItem) => page.type === 'home')
  if (homePath && !pagesArray.some((page: InternalPageItem) => page.path === homePath && page.type === 'home')) {
    // Mark every variant of the home path, not just the first: each
    // platform's variant may sit behind its own #ifdef block, and marking
    // only the first one leaves the current platform's variant stranded
    // behind visible non-home entries until a later self-healing write
    pagesArray.forEach((page: InternalPageItem, index: number) => {
      if (page.path === homePath)
        isHome[index] = true
    })
  }

  const homeCount = isHome.filter(Boolean).length
  if (homeCount === 0)
    return

  // Already partitioned — every home variant precedes every non-home entry:
  // nothing to move, keep the byte-exact output stable across reruns
  if (isHome.slice(0, homeCount).every(Boolean))
    return

  const commentArray = pagesArray as unknown as CommentArray<CommentObject>
  const length = pagesArray.length

  // `CommentArray#splice` only re-indexes the surviving elements' comments:
  // removed slots strand their comments on whatever moves in, misplacing
  // `#ifdef`/`#endif` blocks and the generation marker. Snapshot every
  // entry's comment tokens and drop the symbols first, so the reorder runs
  // on plain array semantics and the tokens are re-attached deliberately.
  // `after-value` needs no handling: `pagesArray` is the freshly built
  // output of mergePlatformItems, whose only comment tokens are `before`
  // entries (#ifdef blocks and the generation marker); user after-value
  // comments are dropped at that earlier stage and cannot reach this
  // function (verified empirically).
  const beforeTokens: Array<CommentToken[]> = []
  const afterTokens: Array<CommentToken[]> = []
  for (let i = 0; i < length; i++) {
    beforeTokens.push(commentArray[Symbol.for(`before:${i}`) as CommentSymbol] || [])
    afterTokens.push(commentArray[Symbol.for(`after:${i}`) as CommentSymbol] || [])
    Reflect.deleteProperty(commentArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(commentArray, Symbol.for(`after:${i}`) as CommentSymbol)
  }

  // before:0 mixes the generation marker with the first entry's own comments
  // (e.g. its #ifdef block): keep the marker on top of the array, the entry
  // tokens travel with their entry
  const markerTokens = beforeTokens[0].filter(isGenerationMarker)
  beforeTokens[0] = beforeTokens[0].filter(token => !isGenerationMarker(token))

  // Stable partition: home variants first, then the rest, both in their
  // original relative order
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

/** Whether a comment token is the pages.json generation marker line */
function isGenerationMarker(token: CommentLineToken | { type: string, value?: string }): boolean {
  return token.type !== 'BlankLine' && typeof token.value === 'string' && token.value.trim().startsWith(GENERATION_MARKER_PREFIX)
}

/** Whether a pages array was written by the plugin (carries the generation marker) */
function hasGenerationMarker(src: CommentArray<CommentObject> | undefined): boolean {
  if (!src)
    return false
  return (src[Symbol.for('before:0') as CommentSymbol] || []).some(isGenerationMarker)
}

/**
 * Compute the merged pages.json content string without touching the file
 * system
 *
 * Pure read-modify-write core: merges the route data into the existing
 * pages.json text (multi-platform `#ifdef` blocks, home reordering,
 * generation marker, sub-package convergence) and serializes it. File
 * locking, change detection and atomic writes stay in {@link writePagesJson};
 * tests exercise this interface directly with plain strings.
 *
 * @param existingContent - Current pages.json text, empty string when missing
 * @param data - Route data assembled by the scan/merge pipeline
 * @param options - Platform, user config and serialization format
 * @returns Serialized pages.json content
 */
export function mergePagesJson(existingContent: string, data: PagesJsonData, options: MergePagesJsonOptions): string {
  const pageJson = mergeIntoPagesJson(existingContent, data, options)

  const minify = options.format?.minify ?? false
  const indent = options.format?.indent ?? 2
  const eol = options.format?.eol ?? '\n'
  let content = cjStringify(pageJson, null, minify ? undefined : indent)
  if (eol !== '\n')
    content = content.replaceAll('\n', eol)

  if (options.format?.insertFinalNewline)
    content += eol

  return content
}

/** Build a line comment token for serialized pages.json output */
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

/** Parse a `||`-separated platform list, dropping the current platform and sorting the rest */
function platformsExcluding(platformList: string, currentPlatform: string): string[] {
  return platformList.split('||').map(p => p.trim()).filter(p => p !== currentPlatform).sort()
}

/**
 * Items may carry an internal `type` marker ('home' | 'page'), but it must not
 * affect equality: entries merged from pages.json may lack the marker
 * (user-written entries never carry it), so a raw JSON.stringify comparison
 * would treat the same page as two different entries and produce duplicate
 * routes across platform runs
 * (see https://github.com/uni-helper/vite-plugin-uni-pages/issues/283).
 * Normalize both sides by dropping `type` before serializing.
 */
function stringifyForCompare<T extends object>(val: T): string {
  if ('type' in val) {
    const { type: _type, ...rest } = val
    return JSON.stringify(rest)
  }
  return JSON.stringify(val)
}

/**
 * Whether two content-equal items agree on home status
 *
 * The `type` marker is excluded from content comparison (see
 * stringifyForCompare), so a marker-less entry still merges with its scanned
 * counterpart. But when both sides explicitly carry a marker and disagree
 * ('home' vs 'page'), they describe different home pages per platform and
 * must stay separate entries behind #ifdef blocks instead of collapsing into
 * whichever run wrote first — collapsing is what kept stale home markers
 * alive after a home switch and silently dropped platform-scoped home
 * declarations.
 */
function homeStatusCompatible(a: object, b: object): boolean {
  const typeA = (a as InternalPageItem).type
  const typeB = (b as InternalPageItem).type
  return typeA === undefined || typeB === undefined || typeA === typeB
}

/** One merged item with the platforms it appears on */
interface MultiPlatformItem<T extends object> {
  item: T
  itemStr: string
  platforms: string[]
  platformStr: string
}

/**
 * Read the platforms recorded by the previous run from the generation marker
 * in `before:0`, dropping the current platform
 */
function extractLastPlatforms(src: CommentArray<CommentObject>, currentPlatform: string): string[] {
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    // comment-json v5 emits BlankLine tokens (without `value`) when the source
    // contains blank lines, e.g. manually formatted pages.json files
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
 * Compute the sorted union of every platform recorded across merged variants
 *
 * The union is the file-wide platform set: it feeds the generation marker
 * and decides which variants may be emitted without an `#ifdef` block.
 * Unwrapped entries are visible to every platform under uni-app conditional
 * compilation, so only variants covering the whole union may go unwrapped.
 * The previous most-used-combination default could resolve to a
 * single-platform combination (dominant platform-exclusive pages or usage
 * ties), emitting that platform's variants bare and leaking them into other
 * platforms' views as duplicate routes
 */
function resolvePlatformUnion<T extends object>(mergedMap: Map<string, MultiPlatformItem<T>[]>): string[] {
  const union = new Set<string>()
  for (const list of mergedMap.values()) {
    for (const { platforms } of list) {
      for (const platform of platforms)
        union.add(platform)
    }
  }
  return [...union].sort()
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

  // 1. Read the platforms recorded by the previous run from the generation marker
  const lastPlatforms = extractLastPlatforms(src, currentPlatform)

  // 2. Iterate source, judge each element, then add to new mergedMap using uniqueKey element value as key
  const mergedMap = new Map<string, MultiPlatformItem<T>[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as unknown as T
    const uniqueKey = (item as Record<string, unknown>)[uniqueKeyName as string] as string

    if (!uniqueKey) {
      continue
    }

    // Check if there are conditional compilation comments
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // BlankLine tokens carry no `value` and must be skipped before matching
    const ifdefComment = beforeComments?.find((c): c is CommentLineToken => c.type !== 'BlankLine' && c.value.trim().startsWith('#ifdef'))

    let platforms: string[] = [...lastPlatforms]

    if (ifdefComment) {
      const match = ifdefComment.value.match(/#ifdef\s+(.+)/)
      if (match) {
        // Remove current platform
        platforms = platformsExcluding(match[1], currentPlatform)
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
  // The internal `type` marker stays on scanned entries by design (it powers
  // the home fallback in ensureHomePageFirst on later runs); only the
  // equality comparison normalizes it away (stringifyForCompare)
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
    const equalObj = existing.find(val => val.itemStr === itemStr && homeStatusCompatible(val.item, item))
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

  // Only variants covering the full platform union may be emitted without
  // an #ifdef block: unwrapped entries are visible to every platform, so a
  // narrower variant must stay wrapped to keep other platforms' views clean
  const platformUnionStr = resolvePlatformUnion(mergedMap).join(' || ') || currentPlatform

  // Add generation identifier comment to result's Symbol.for(`before:0`)
  result[Symbol.for('before:0') as CommentSymbol] = [lineComment(` ${GENERATION_MARKER_PREFIX} ${platformUnionStr}`)]

  // Process elements in insertion order
  for (const [_, list] of mergedMap) {
    for (const { item, platformStr } of list) {
      result.push(item as unknown as CommentObject)

      // Check if the variant covers the full platform union (both strings are pre-sorted)
      if (platformStr !== platformUnionStr) {
        // Variant covers only a subset of the platforms: wrap it so the
        // other platforms' conditional-compilation views skip it.
        // Append instead of replacing: before:0 may already carry the
        // generation marker, which must stay at the top of the array
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [
          ...(result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] || []),
          lineComment(` #ifdef ${platformStr}`),
        ]

        result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = [lineComment(' #endif')]
      }
    }
  }

  return result
}
