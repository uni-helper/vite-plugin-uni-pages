import type { ResolvedOptions, SubPackageConfig } from './types'
import fs from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { globSync, isDynamicPattern } from 'tinyglobby'
import { normalizePath } from 'vite'
import { compilePageRules, getPageRules } from './page-rules'

function findPageDirs(dir: string, root: string, rules: ReturnType<typeof compilePageRules>): string[] {
  const scan = picomatch.scan(normalizePath(dir))
  if (rules.isExcluded(path.resolve(root, scan.base || '.')))
    return []
  return globSync(normalizePath(dir), {
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

/** 展开子包规则，保留旧静态目录的自定义 root 语义 */
export function resolveSubPackageDirs(patterns: (string | SubPackageConfig)[], root: string, outDir: string, exclude: string[]): Pick<ResolvedOptions, 'subPackages' | 'subPackageRootMap' | 'dynamicSubPackageRoots'> {
  const rules = compilePageRules(root, [], exclude)
  const entries = new Map<string, { dir: string, root: string, customRoot?: string, dynamic: boolean }>()
  for (const pattern of patterns) {
    const dir = normalizePath(typeof pattern === 'string' ? pattern : pattern.dir)
    if (picomatch.scan(dir).negated)
      throw new Error('[vite-plugin-uni-pages] Use exclude for negative subpackage patterns.')
    const customRoot = typeof pattern === 'string' ? undefined : pattern.root
    const dynamic = isDynamicPattern(dir) || typeof customRoot === 'function'
    const dirs = dynamic ? findPageDirs(dir, root, rules) : [dir]
    for (const matched of dirs) {
      const absolute = normalizePath(path.resolve(root, matched))
      if (rules.isExcluded(absolute))
        continue
      const relative = normalizePath(path.relative(root, absolute)) || '.'
      const resolvedRoot = typeof customRoot === 'function' ? customRoot(relative) : customRoot
      if (typeof customRoot === 'function' && (typeof resolvedRoot !== 'string' || !resolvedRoot || resolvedRoot === '.' || path.posix.isAbsolute(resolvedRoot) || path.win32.isAbsolute(resolvedRoot) || resolvedRoot.replace(/\\/g, '/').split('/').includes('..'))) {
        throw new Error(`[vite-plugin-uni-pages] Invalid subpackage root returned for "${relative}": expected a non-empty relative path without "..".`)
      }
      const packageRoot = resolvedRoot === undefined ? normalizePath(path.relative(path.resolve(root, outDir), absolute)) : normalizePath(resolvedRoot)
      // 同一物理目录得到不同的 root 一律报错：静态规则之间也会静默取
      // 最后一条，配置写错时 pages.json 的 root 取决于声明顺序
      const previous = entries.get(absolute)
      if (previous && previous.root !== packageRoot) {
        throw new Error(`[vite-plugin-uni-pages] Conflicting subpackage roots for "${relative}": "${previous.root}" and "${packageRoot}".`)
      }
      entries.set(absolute, {
        dir: dynamic ? relative : matched,
        root: packageRoot,
        customRoot: resolvedRoot === undefined ? undefined : packageRoot,
        dynamic: dynamic || previous?.dynamic === true,
      })
    }
  }
  return {
    subPackages: [...entries.values()].map(entry => entry.dir),
    subPackageRootMap: new Map([...entries.values()].filter(entry => entry.customRoot !== undefined).map(entry => [entry.dir, entry.customRoot!])),
    dynamicSubPackageRoots: new Set([...entries.values()].filter(entry => entry.dynamic).map(entry => entry.root)),
  }
}

/** 在一次扫描前刷新目录和 root 映射，避免沿用启动时的 glob 结果 */
export function refreshPageDirectories(options: ResolvedOptions): void {
  const subPackages = resolveSubPackageDirs(options.subPackagePatterns, options.root, options.outDir, options.exclude)
  options.dirs = resolvePageDirs(options.dir, options.root, options.exclude)
  Object.assign(options, subPackages)
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
    const scan = picomatch.scan(normalizePath(pattern))
    const base = normalizePath(path.resolve(options.root, scan.isGlob ? scan.base || '.' : pattern))
    // 整条规则被排除时不会有页面，不必再为它保留监听祖先
    if (rules.isExcluded(base))
      return []
    let directory = base === normalizePath(options.root) ? base : path.dirname(base)
    while (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      const parent = path.dirname(directory)
      if (parent === directory)
        break
      directory = parent
    }
    return [normalizePath(directory)]
  })
  return [...new Set(roots)].filter(root => !roots.some(parent => parent !== root && contains(parent, root)))
}
