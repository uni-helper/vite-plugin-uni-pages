import type { ResolvedOptions, SubPackageConfig } from './types'
import fs from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { globSync, isDynamicPattern } from 'tinyglobby'
import { normalizePath } from 'vite'

/** 根据 glob 查找目录，结果相对 root 并按路径排序 */
export function resolvePageDirs(dir: string, root: string, exclude: string[]): string[] {
  return globSync(normalizePath(dir), {
    ignore: exclude,
    onlyDirectories: true,
    expandDirectories: false,
    dot: true,
    cwd: root,
  }).map(normalizePath).sort()
}

/** 展开子包规则，保留旧静态目录的自定义 root 语义 */
export function resolveSubPackageDirs(patterns: (string | SubPackageConfig)[], root: string, outDir: string, exclude: string[]): Pick<ResolvedOptions, 'subPackages' | 'subPackageRootMap' | 'dynamicSubPackageRoots'> {
  const entries = new Map<string, { dir: string, root: string, customRoot?: string, dynamic: boolean }>()
  for (const pattern of patterns) {
    const dir = normalizePath(typeof pattern === 'string' ? pattern : pattern.dir)
    if (picomatch.scan(dir).negated)
      throw new Error('[vite-plugin-uni-pages] Use exclude for negative subpackage patterns.')
    const customRoot = typeof pattern === 'string' ? undefined : pattern.root
    const dynamic = isDynamicPattern(dir) || typeof customRoot === 'function'
    const dirs = dynamic ? resolvePageDirs(dir, root, exclude) : [dir]
    for (const matched of dirs) {
      const absolute = normalizePath(path.resolve(root, matched))
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

function directoryPatterns(options: ResolvedOptions): string[] {
  return [options.dir, ...options.subPackagePatterns.map(pattern => typeof pattern === 'string' ? pattern : pattern.dir)].filter(pattern => !picomatch.scan(pattern).negated)
}

function contains(directory: string, entry: string): boolean {
  return entry === directory || entry.startsWith(`${directory.replace(/\/$/, '')}/`)
}

function isExcluded(entry: string, exclude: string[]): boolean {
  const matches = picomatch(exclude, { dot: true })
  let current = entry
  while (current && current !== '.' && current !== '/') {
    if (matches(current))
      return true
    const parent = path.posix.dirname(current)
    if (parent === current)
      break
    current = parent
  }
  return false
}

function matchesDirectory(absolute: string, options: ResolvedOptions): boolean {
  const relative = normalizePath(path.relative(options.root, absolute)) || '.'
  if (isExcluded(relative, options.exclude))
    return false
  return directoryPatterns(options).some((pattern) => {
    const resolved = normalizePath(path.relative(options.root, path.resolve(options.root, pattern))) || '.'
    return picomatch(resolved, { dot: true })(relative)
  })
}

/** 判断目录新增或删除是否可能改变扫描目录集合 */
export function isPageDirectoryEvent(directory: string, options: ResolvedOptions): boolean {
  if (!options.mergePages)
    return false
  const absolute = normalizePath(path.resolve(options.root, directory))
  if (matchesDirectory(absolute, options))
    return true
  return [...options.dirs, ...options.subPackages].some(dir => contains(absolute, normalizePath(path.resolve(options.root, dir))))
}

/** 判断页面文件是否位于当前规则内，包含尚未完成扫描的新目录 */
export function isPageFileInDirectories(file: string, options: ResolvedOptions): boolean {
  if (!options.mergePages)
    return false
  const absolute = normalizePath(path.resolve(options.root, file))
  let directory = normalizePath(path.dirname(absolute))
  while (true) {
    if (matchesDirectory(directory, options) && !isExcluded(normalizePath(path.relative(directory, absolute)), options.exclude))
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
  const roots = directoryPatterns(options).map((pattern) => {
    const scan = picomatch.scan(normalizePath(pattern))
    const base = normalizePath(path.resolve(options.root, scan.isGlob ? scan.base || '.' : pattern))
    let directory = base === normalizePath(options.root) ? base : path.dirname(base)
    while (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      const parent = path.dirname(directory)
      if (parent === directory)
        break
      directory = parent
    }
    return normalizePath(directory)
  })
  return [...new Set(roots)].filter(root => !roots.some(parent => parent !== root && contains(parent, root)))
}
