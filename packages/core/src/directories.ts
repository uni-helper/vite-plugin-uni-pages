import type { ResolvedOptions, SubPackageConfig } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import picomatch from 'picomatch'
import { globSync, isDynamicPattern } from 'tinyglobby'
import { normalizePath } from 'vite'
import { compilePageRules, getPageRules } from './page-rules'

/**
 * 用户写的 `dir`/`subPackages` 是 glob 模式
 *
 * Windows 上要把路径分隔符换成 `/`，但不能用 vite 的 normalizePath：它会把
 * `\[` 这类转义一起换掉，字面目录名就再也匹配不到了。
 */
function normalizePagePattern(pattern: string): string {
  return process.platform === 'win32' ? pattern.replace(/\\(?![()[\]{}!+@])/g, '/') : pattern
}

/** 把选择器里的转义还原，用作真实路径前的处理 */
function unescapePagePattern(pattern: string): string {
  return pattern.replace(/\\(?=[[\](){}!*+?@|])/g, '')
}

function findPageDirs(dir: string, root: string, rules: ReturnType<typeof compilePageRules>): string[] {
  if (dir === '' || picomatch.scan(dir).negated)
    return []
  // 与 tinyglobby 和 matcher 一样先消解 .、..，再推导可安全剪枝的基准
  const pattern = path.posix.normalize(normalizePagePattern(dir))
  const scan = picomatch.scan(pattern)
  if (rules.isExcluded(path.resolve(root, unescapePagePattern(scan.base || '.'))))
    return []
  return globSync(pattern, {
    ignore: rules.traversalIgnores,
    onlyDirectories: true,
    expandDirectories: false,
    dot: true,
    cwd: root,
  }).map(normalizePath).filter(directory => !rules.isExcluded(path.resolve(root, directory))).sort()
}

/** 根据 glob 查找目录，结果相对 root 并按路径排序 */
export function resolvePageDirs(dir: string, root: string, exclude: string[]): string[] {
  return findPageDirs(dir, root, compilePageRules(root, [dir], exclude))
}

/** 一轮目录发现中保留的词法来源，identity 仅用于目录归组 */
export interface SubPackageDirectorySource {
  dir: string
  absolute: string
  identity?: string
  root: string
  explicitRoot: boolean
  ruleIndex: number
  matchIndex: number
  rootSource: { dir: string, ruleIndex: number, explicitRoot: boolean }
}

interface DirectoryCandidate extends SubPackageDirectorySource {
  defaultRoot: string
  dynamic: boolean
}

type SubPackageDirectoryProjection = Pick<ResolvedOptions, 'subPackages' | 'subPackageRootMap' | 'dynamicSubPackageRoots'>

const subPackageSources = new WeakMap<ResolvedOptions, readonly SubPackageDirectorySource[]>()

function directoryIdentity(absolute: string): string | undefined {
  try {
    if (fs.statSync(absolute, { throwIfNoEntry: false })?.isDirectory())
      return normalizePath(fs.realpathSync.native(absolute))
  }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error
  }
}

function findCallbackDirectory(dir: string, root: string, rules: ReturnType<typeof compilePageRules>): string[] {
  if (dir === '')
    return []
  const absolute = path.resolve(root, unescapePagePattern(path.posix.normalize(dir)))
  if (rules.isExcluded(absolute))
    return []
  try {
    // tinyglobby 不返回符号链接目录本身；字面回调规则仍须按该词法来源求值
    if (fs.statSync(absolute, { throwIfNoEntry: false })?.isDirectory())
      return [normalizePath(path.relative(root, absolute)) || '.']
  }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error
  }
  return []
}

function discoverSubPackageDirectories(patterns: (string | SubPackageConfig)[], root: string, outDir: string, exclude: string[]): { sources: SubPackageDirectorySource[], projection: SubPackageDirectoryProjection } {
  const rules = compilePageRules(root, [], exclude)
  const candidates: DirectoryCandidate[] = []
  const groups = new Map<string, DirectoryCandidate[]>()
  for (const [ruleIndex, pattern] of patterns.entries()) {
    const dir = normalizePagePattern(typeof pattern === 'string' ? pattern : pattern.dir)
    if (picomatch.scan(dir).negated)
      throw new Error('[vite-plugin-uni-pages] Use exclude for negative subpackage patterns.')
    const customRoot = typeof pattern === 'string' ? undefined : pattern.root
    const glob = isDynamicPattern(dir)
    const dynamic = glob || typeof customRoot === 'function'
    const dirs = glob ? findPageDirs(dir, root, rules) : typeof customRoot === 'function' ? findCallbackDirectory(dir, root, rules) : [dir]
    for (const [matchIndex, matched] of dirs.entries()) {
      // 静态规则的匹配结果就是配置里的路径，可能带 `\[` 这类转义，用前还原
      const resolved = dynamic ? matched : unescapePagePattern(matched)
      const absolute = normalizePath(path.resolve(root, resolved))
      if (rules.isExcluded(absolute))
        continue
      const relative = normalizePath(path.relative(root, absolute)) || '.'
      const resolvedRoot = typeof customRoot === 'function' ? customRoot(relative) : customRoot
      if (typeof customRoot === 'function' && (typeof resolvedRoot !== 'string' || !resolvedRoot || resolvedRoot === '.' || path.posix.isAbsolute(resolvedRoot) || path.win32.isAbsolute(resolvedRoot) || resolvedRoot.replace(/\\/g, '/').split('/').includes('..'))) {
        throw new Error(`[vite-plugin-uni-pages] Invalid subpackage root returned for "${relative}": expected a non-empty relative path without "..".`)
      }
      const defaultRoot = normalizePath(path.relative(path.resolve(root, outDir), absolute))
      const identity = directoryIdentity(absolute)
      const candidate: DirectoryCandidate = {
        dir: dynamic ? relative : resolved,
        absolute,
        identity,
        root: resolvedRoot === undefined ? defaultRoot : normalizePath(resolvedRoot),
        explicitRoot: resolvedRoot !== undefined,
        ruleIndex,
        matchIndex,
        rootSource: { dir: dynamic ? relative : resolved, ruleIndex, explicitRoot: resolvedRoot !== undefined },
        defaultRoot,
        dynamic,
      }
      candidates.push(candidate)
      const key = identity ?? absolute
      const group = groups.get(key) ?? []
      group.push(candidate)
      groups.set(key, group)
    }
  }

  for (const group of groups.values()) {
    const explicit = group.filter(candidate => candidate.explicitRoot)
    const selected = explicit[0] ?? group[0]!
    for (const candidate of explicit) {
      if (candidate.root !== selected.root) {
        throw new Error(`[vite-plugin-uni-pages] Conflicting subpackage roots: "${selected.dir}" (subPackages[${selected.ruleIndex}]) uses "${selected.root}", but "${candidate.dir}" (subPackages[${candidate.ruleIndex}]) uses "${candidate.root}".`)
      }
    }
    // 仅统一归属，不移除别名来源；文件排除仍需分别使用各自的词法路径
    for (const candidate of group) {
      candidate.root = selected.root
      candidate.rootSource = selected.rootSource
    }
  }

  const roots = new Map<string, string>()
  for (const candidate of candidates) {
    if (candidate.explicitRoot || candidate.root !== candidate.defaultRoot)
      roots.set(candidate.dir, candidate.root)
  }
  return {
    sources: candidates.map(({ defaultRoot: _defaultRoot, dynamic: _dynamic, ...source }) => source),
    projection: {
      subPackages: [...new Set(candidates.map(candidate => candidate.dir))],
      subPackageRootMap: roots,
      dynamicSubPackageRoots: new Set(candidates.filter(candidate => candidate.dynamic).map(candidate => candidate.root)),
    },
  }
}

/** 展开子包规则，默认 root 让位于同一目录的显式 root */
export function resolveSubPackageDirs(patterns: (string | SubPackageConfig)[], root: string, outDir: string, exclude: string[]): SubPackageDirectoryProjection {
  return discoverSubPackageDirectories(patterns, root, outDir, exclude).projection
}

/** 读取本轮目录来源，不跨扫描缓存目录展开或物理身份 */
export function getSubPackageDirectorySources(options: ResolvedOptions): readonly SubPackageDirectorySource[] {
  let sources = subPackageSources.get(options)
  if (!sources) {
    sources = discoverSubPackageDirectories(options.subPackagePatterns, options.root, options.outDir, options.exclude).sources
    subPackageSources.set(options, sources)
  }
  return sources
}

/** 在一次扫描前刷新目录和 root 映射，避免沿用启动时的 glob 结果 */
export function refreshPageDirectories(options: ResolvedOptions): void {
  const { sources, projection } = discoverSubPackageDirectories(options.subPackagePatterns, options.root, options.outDir, options.exclude)
  options.dirs = resolvePageDirs(options.dir, options.root, options.exclude)
  Object.assign(options, projection)
  subPackageSources.set(options, sources)
}

function contains(directory: string, entry: string): boolean {
  return entry === directory || entry.startsWith(`${directory.replace(/\/$/, '')}/`)
}

/** 判断目录新增或删除是否可能改变扫描目录集合 */
export function isPageDirectoryEvent(directory: string, options: ResolvedOptions): boolean {
  if (!options.mergePages)
    return false
  const absolute = normalizePath(path.resolve(options.root, directory))
  const rules = getPageRules(options)
  if (rules.isExcluded(absolute))
    return false
  if (rules.matchesDirectory(absolute))
    return true
  return [...options.dirs, ...options.subPackages].some(dir => contains(absolute, normalizePath(path.resolve(options.root, dir))))
}

/** 判断页面文件是否位于当前规则内，包含尚未完成扫描的新目录 */
export function isPageFileInDirectories(file: string, options: ResolvedOptions): boolean {
  if (!options.mergePages)
    return false
  const absolute = normalizePath(path.resolve(options.root, file))
  const rules = getPageRules(options)
  if (rules.isExcluded(absolute))
    return false
  let directory = normalizePath(path.dirname(absolute))
  while (true) {
    if (rules.matchesDirectory(directory))
      return true
    const parent = normalizePath(path.dirname(directory))
    if (parent === directory)
      return false
    directory = parent
  }
}

/** 找到稳定的已有祖先，覆盖启动时尚不存在的多级目录 */
export function resolvePageWatchDirectories(options: ResolvedOptions): string[] {
  if (!options.mergePages)
    return []
  const rules = getPageRules(options)
  const roots = rules.patterns.flatMap((pattern) => {
    const normalized = path.posix.normalize(normalizePagePattern(pattern))
    const scan = picomatch.scan(normalized)
    const base = normalizePath(path.resolve(options.root, unescapePagePattern(scan.isGlob ? scan.base || '.' : normalized)))
    // 整条规则被排除时不会有页面，不必再为它保留监听祖先
    if (rules.isExcluded(base))
      return []
    let directory = base === normalizePath(options.root) ? base : path.dirname(base)
    while (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      const parent = path.dirname(directory)
      if (parent === directory)
        break
      directory = parent
    }
    return [normalizePath(directory)]
  })
  return [...new Set(roots)].filter(root => !roots.some(parent => parent !== root && contains(parent, root)))
}
