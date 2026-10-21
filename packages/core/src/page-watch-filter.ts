import type { Stats } from 'node:fs'
import type { WatchOptions } from 'vite'
import path from 'node:path'
import picomatch from 'picomatch'
import { normalizePath } from 'vite'

/**
 * 编译 Vite 的 ignored 规则，匹配单个页面来源的词法路径
 *
 * @description 返回 true 表示忽略；否定模式优先于其他匹配，目录祖先由调用方检查
 * @param ignored - Vite 的字符串、正则或函数过滤规则
 * @param root - 待检查路径的解析基准
 * @param cwd - watcher 为相对字符串规则指定的基准，未指定时保留相对模式
 */
export function createPageWatchFilter(ignored: WatchOptions['ignored'], root: string, cwd = ''): (file: string, stats?: Stats) => boolean {
  const normalized = (ignored === undefined ? [] : Array.isArray(ignored) ? ignored : [ignored]).map((matcher) => {
    if (typeof matcher !== 'string')
      return matcher
    return normalizePath(path.normalize(path.isAbsolute(matcher) ? matcher : path.join(cwd, matcher)))
  })
  // 字面目录规则同时覆盖后代，与 Vite 的 Chokidar 规则保持一致
  const matchers = [
    ...normalized,
    ...normalized.filter((matcher): matcher is string => typeof matcher === 'string' && !matcher.startsWith('!') && !picomatch.scan(matcher).isGlob).map(matcher => `${matcher}/**`),
  ]
  const negative = matchers.filter((matcher): matcher is string => typeof matcher === 'string' && matcher.startsWith('!'))
    .map(matcher => picomatch(matcher.slice(1), { dot: true }))
  const positive = matchers.filter(matcher => typeof matcher !== 'string' || !matcher.startsWith('!')).map((matcher) => {
    if (typeof matcher === 'function')
      return matcher as (file: string, stats?: Stats) => boolean
    if (matcher instanceof RegExp)
      return (file: string): boolean => matcher.test(file)
    const matches = picomatch(matcher, { dot: true })
    return (file: string): boolean => file === matcher || matches(file)
  })
  return (file, stats) => {
    const absolute = normalizePath(path.resolve(root, file))
    return !negative.some(matches => matches(absolute)) && positive.some(matches => matches(absolute, stats))
  }
}
