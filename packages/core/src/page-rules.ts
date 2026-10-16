/**
 * 页面目录与排除规则的编译
 *
 * 规则以项目根为基准，动态目录发现与物理身份不参与编译缓存
 */
import type { ResolvedOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import picomatch from 'picomatch'
import { escapePath } from 'tinyglobby'
import { normalizePath } from 'vite'

/** 目录发现、文件扫描和事件判断共用的词法路径规则 */
interface PageRules {
  /** 尚未展开的目录选择器，用于寻找监听祖先 */
  patterns: readonly string[]
  /** 可交给 tinyglobby 提前剪枝的保守模式子集，相对项目根 */
  traversalIgnores: readonly string[]
  isExcluded: (absoluteRulePath: string) => boolean
  matchesDirectory: (absoluteRulePath: string) => boolean
}

/** 已固定绝对或项目相对基准的单条路径模式 */
interface CompiledPathRule {
  pattern: string
  absolute: boolean
  matches: (absoluteRulePath: string) => boolean
}

const ruleCache = new WeakMap<ResolvedOptions, { fingerprint: string, rules: PageRules }>()

/**
 * 编译以项目根为基准的规则，不查询目录是否存在
 *
 * @description 排除同时作用于路径自身和祖先；空模式忽略，否定排除报错，extglob 保留
 */
export function compilePageRules(root: string, patterns: readonly string[], exclude: readonly string[]): PageRules {
  const absoluteRoot = normalizePath(path.resolve(root))
  const escapedRoot = escapePath(absoluteRoot)
  const relative = (absolute: string): string => normalizePath(path.relative(absoluteRoot, absolute)) || '.'
  const matchOptions = { dot: true, posix: true }
  const compilePattern = (pattern: string): CompiledPathRule => {
    const portable = process.platform === 'win32' ? pattern.replace(/\\(?![()[\]{}!+@])/g, '/') : pattern
    const absolute = path.isAbsolute(portable)
    // 绝对 glob 的通配符可出现在项目根所在段，不能先当成字面路径相对化
    let normalized = absolute
      ? path.posix.normalize(portable)
      : path.posix.relative(escapedRoot, path.posix.resolve(escapedRoot, portable)) || '.'
    if (absolute && normalized !== normalizePath(path.parse(portable).root))
      normalized = normalized.replace(/\/$/, '')
    const matches = picomatch(normalized, matchOptions)
    return {
      pattern: normalized,
      absolute,
      matches: (candidate: string): boolean => matches(absolute ? normalizePath(candidate) : relative(candidate)),
    }
  }
  const exclusions = exclude.filter(pattern => pattern !== '').map((pattern) => {
    if (picomatch.scan(pattern).negated)
      throw new Error(`[vite-plugin-uni-pages] Negative exclude pattern "${pattern}" cannot re-include pages. Remove it from exclude.`)
    return compilePattern(pattern)
  })
  const directoryPatterns = patterns.filter(pattern => pattern !== '' && !picomatch.scan(pattern).negated)
  // 与 tinyglobby 的 POSIX 字符类语义一致，例如 [!a]
  const directories = directoryPatterns.map(compilePattern)
  const isExcluded = (absoluteRulePath: string): boolean => {
    let current = path.resolve(absoluteRulePath)
    while (true) {
      if (exclusions.some(rule => rule.matches(current)))
        return true
      const parent = path.dirname(current)
      if (parent === current)
        return false
      current = parent
    }
  }

  return {
    patterns: directoryPatterns,
    // 复杂表达式只由统一 matcher 判定，避免第二套规范化提前删掉有效页面
    traversalIgnores: exclusions.filter(rule => !rule.absolute && !/[!()[\]{}\\+@|]/.test(rule.pattern)).map(rule => rule.pattern),
    isExcluded,
    matchesDirectory: absolute => !isExcluded(absolute) && directories.some(rule => rule.matches(absolute)),
  }
}

/** 复用当前声明的编译结果，原地修改路径规则或排除项后重新编译 */
export function getPageRules(options: ResolvedOptions): PageRules {
  const patterns = [options.dir, ...options.subPackagePatterns.map(pattern => typeof pattern === 'string' ? pattern : pattern.dir)]
  const fingerprint = JSON.stringify([options.root, patterns, options.exclude])
  const cached = ruleCache.get(options)
  if (cached?.fingerprint === fingerprint)
    return cached.rules
  const rules = compilePageRules(options.root, patterns, options.exclude)
  ruleCache.set(options, { fingerprint, rules })
  return rules
}
