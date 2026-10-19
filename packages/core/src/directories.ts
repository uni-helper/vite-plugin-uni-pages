import type { ResolvedOptions, ScanSourceCoordinate, ScanSourceOrigin, SubPackageConfig } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import picomatch from 'picomatch'
import { globSync, isDynamicPattern } from 'tinyglobby'
import { normalizePath } from 'vite'
import { isMissingFsError } from './files'
import { compilePageRules, getPageRules } from './page-rules'
import { comparePageSources } from './page-sources'

/**
 * 统一目录选择器的 Windows 路径分隔符
 *
 * @description 保留 `\[` 等 glob 转义，避免 normalizePath 将转义字符一起替换
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

/**
 * 查找当前可扫描的页面目录
 *
 * @description 应用目录排除后，返回相对 root、按路径排序的匹配结果；空规则或否定规则返回空数组
 *
 * @param dir 页面目录 glob，可使用绝对路径
 * @param root 相对目录和相对 exclude 的解析基准
 * @param exclude 目录及页面排除规则
 */
export function resolvePageDirs(dir: string, root: string, exclude: string[]): string[] {
  return findPageDirs(dir, root, compilePageRules(root, [dir], exclude))
}

/** 单次分包目录发现保留的来源记录 */
export interface SubPackageDirectorySource extends ScanSourceCoordinate {
  /**
   * 扫描目录的词法路径，与 subPackages 的目录投影一致
   *
   * @description glob 或回调来源相对 Vite root，静态来源保留声明的绝对或相对写法
   */
  dir: string
  /** 相对 Vite root 解析的绝对路径，保留符号链接别名 */
  absolute: string
  /** 目录的 realpath 身份；缺失、非目录或解析期间消失时为 undefined */
  identity?: string
  /** 同一物理目录完成显式／默认来源决议后的最终分包 root */
  root: string
  /** 最终 root 的选择来源，可能与当前声明不同 */
  rootSource: ScanSourceOrigin
}

interface DirectoryCandidate extends SubPackageDirectorySource {
  defaultRoot: string
}

type SubPackageDirectoryProjection = Pick<ResolvedOptions, 'subPackages' | 'subPackageRootMap'>

// 与规则编译缓存分开；目录展开和身份必须随每轮扫描刷新
const subPackageSources = new WeakMap<ResolvedOptions, readonly SubPackageDirectorySource[]>()

function directoryIdentity(absolute: string): string | undefined {
  try {
    if (fs.statSync(absolute, { throwIfNoEntry: false })?.isDirectory())
      return normalizePath(fs.realpathSync.native(absolute))
  }
  catch (error) {
    // 删除或重命名中的目录按缺失处理，权限等真实错误仍交给调用方
    if (!isMissingFsError(error))
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
    if (!isMissingFsError(error))
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
    // 非 glob、非回调声明保留缺失目录投影，回调只对已存在的目录求值
    const dirs = glob ? findPageDirs(dir, root, rules) : typeof customRoot === 'function' ? findCallbackDirectory(dir, root, rules) : [dir]
    for (const [matchIndex, matched] of dirs.entries()) {
      // 静态规则的匹配结果就是配置里的路径，可能带 `\[` 这类转义，用前还原
      const resolved = dynamic ? matched : unescapePagePattern(matched)
      const absolute = normalizePath(path.resolve(root, resolved))
      if (rules.isExcluded(absolute))
        continue
      const relative = normalizePath(path.relative(root, absolute)) || '.'
      // 先按各词法来源求值，避免身份归组提前吞掉别名回调或显式冲突
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
      }
      candidates.push(candidate)
      // 缺失目录仍可校验同一路径的声明冲突，但不能伪造物理身份
      const key = identity ?? absolute
      const group = groups.get(key) ?? []
      group.push(candidate)
      groups.set(key, group)
    }
  }

  // 默认值不参与显式值冲突；没有显式来源时才采用声明顺序中的默认值
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

  // 同一物理路径的不同写法（如 `src/pkg` 与 `src/pkg/`）只保留一个扫描入口，
  // 否则会重复执行 glob 和身份解析；符号链接别名是不同的 absolute，仍分别保留
  const directories = new Map<string, DirectoryCandidate>()
  for (const candidate of candidates) {
    const previous = directories.get(candidate.absolute)
    if (!previous || comparePageSources(candidate, previous) < 0)
      directories.set(candidate.absolute, candidate)
  }

  // 默认别名继承其他来源的 root 后也需登记，避免读取方按该别名重算默认值
  const roots = new Map<string, string>()
  for (const candidate of directories.values()) {
    if (candidate.explicitRoot || candidate.root !== candidate.defaultRoot)
      roots.set(candidate.dir, candidate.root)
  }
  return {
    // 声明记录逐条保留，root 决议与诊断仍需知道每条声明的位置
    sources: candidates.map(({ defaultRoot: _defaultRoot, ...source }) => source),
    projection: {
      subPackages: [...directories.values()].map(candidate => candidate.dir),
      subPackageRootMap: roots,
    },
  }
}

/**
 * 展开分包目录并确定各目录的最终 root
 *
 * @description 每次调用重新发现目录并求值回调；按声明顺序排列，glob 内按路径排序
 * 同一物理目录的显式 root 优先于默认值，词法别名分别保留，重复目录投影只登记一次
 *
 * @param patterns 原始分包目录声明
 * @param root 相对目录和相对 exclude 的解析基准
 * @param outDir 默认分包 root 的换算基准，相对 root 解析
 * @param exclude 目录及页面排除规则
 * @returns 目录列表及最终 root 映射
 * @throws 目录规则无效、root 回调失败、显式 root 冲突或非缺失类目录访问错误
 */
export function resolveSubPackageDirs(patterns: (string | SubPackageConfig)[], root: string, outDir: string, exclude: string[]): SubPackageDirectoryProjection {
  return discoverSubPackageDirectories(patterns, root, outDir, exclude).projection
}

/**
 * 读取最近一次发现的分包目录来源快照
 *
 * @description 首次读取会发现并保存来源；已有快照时直接返回，不重新展开目录或执行回调
 * 扫描前或声明、排除规则、目录状态变化后，应先调用 refreshPageDirectories
 *
 * @returns 按声明及匹配顺序排列的来源，调用方应只读使用记录
 * @throws 首次发现时的目录规则、root 决议或目录访问错误
 */
export function getSubPackageDirectorySources(options: ResolvedOptions): readonly SubPackageDirectorySource[] {
  let sources = subPackageSources.get(options)
  if (!sources) {
    sources = discoverSubPackageDirectories(options.subPackagePatterns, options.root, options.outDir, options.exclude).sources
    subPackageSources.set(options, sources)
  }
  return sources
}

/**
 * 刷新扫描目录、分包 root 及来源快照
 *
 * @description 每次扫描前调用，原地更新 options 中的目录及 root 投影，并替换来源快照
 * 目录匹配、物理身份和 root 回调均重新计算，避免沿用上一轮的目录状态
 *
 * @throws 目录规则、root 决议或目录访问失败时抛出，应中止本轮扫描
 */
export function refreshPageDirectories(options: ResolvedOptions): void {
  const { sources, projection } = discoverSubPackageDirectories(options.subPackagePatterns, options.root, options.outDir, options.exclude)
  options.dirs = resolvePageDirs(options.dir, options.root, options.exclude)
  Object.assign(options, projection)
  subPackageSources.set(options, sources)
}

function contains(directory: string, entry: string): boolean {
  return entry === directory || entry.startsWith(`${directory.replace(/\/$/, '')}/`)
}

/**
 * 判断目录事件是否可能改变扫描目录集合
 *
 * @description directory 相对 options.root 解析，允许目录已删除；关闭 mergePages 时返回 false
 */
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

/**
 * 判断文件路径是否位于当前页面规则内
 *
 * @description file 相对 options.root 解析，按原始规则与 exclude 判断，不要求文件存在或目录已展开
 * 关闭 mergePages 时返回 false，文件扩展名由调用方校验
 */
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

/**
 * 查找覆盖页面来源的稳定监听目录
 *
 * @description 每次调用重新探测已有祖先，返回去除重复覆盖后的绝对路径
 * 被完整排除的来源不贡献监听目录，尚不存在的多级目录由已有祖先覆盖；关闭 mergePages 时返回空数组
 */
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
