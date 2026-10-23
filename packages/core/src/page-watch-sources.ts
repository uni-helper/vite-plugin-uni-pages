import type { Dirent } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { isMissingFsError, isTargetFile } from './files'

/** 单轮来源发现最多登记的链接来源数，避免别名层叠造成指数级遍历和订阅膨胀 */
export const PAGE_WATCH_SOURCE_LIMIT = 1024

/** 目标不可访问与缺失一样按暂不可用处理，权限恢复后再由后续刷新重新发现 */
export function isUnavailableSourceError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
}

/**
 * 将监听目标统一到真实路径
 *
 * @description 与事件 identity 使用同一基准，避免目标拼写差异（大小写、Unicode
 * 规范化）导致映射失败；尚未创建的部分保留在最近存在祖先的真实路径下
 */
function canonicalTargetPath(target: string): string {
  let current = target
  const missing: string[] = []
  while (true) {
    try {
      const real = fs.realpathSync.native(current)
      return normalizePath(missing.length ? path.join(real, ...missing) : real)
    }
    catch (error) {
      // 规范化只影响目标身份；权限等错误由监听发现按不可用处理，不能借此中断生成
      if (!isMissingFsError(error))
        return normalizePath(target)
      const parent = path.dirname(current)
      if (parent === current)
        return normalizePath(target)
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/** 一个词法入口当前可解析的物理目标 */
export interface SourceTarget {
  /** 已解析链接的绝对路径，目标缺失时保留可确认的指向 */
  target: string
  exists: boolean
  /** 解析过程中经过的链接入口，用于观察改指或重建 */
  links: string[]
  /** 目标存在时的类型；无法解析时为 undefined */
  kind?: 'directory' | 'file'
  /** 已存在目标的 dev:ino，用于识别目录重建 */
  identity?: string
}

/** 逐段解析链接，保留悬空目标及恢复所需的链接入口 */
export function resolveWatchTarget(source: string): SourceTarget {
  let remaining = path.resolve(source)
  const links = new Set<string>()
  const visited = new Set<string>()
  while (!visited.has(remaining) && visited.size < 40) {
    visited.add(remaining)
    const root = path.parse(remaining).root
    const parts = remaining.slice(root.length).split(path.sep).filter(Boolean)
    let current = root
    let redirected = false
    let stat: fs.BigIntStats | undefined
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part)
      try {
        stat = fs.lstatSync(current, { bigint: true })
        if (stat.isSymbolicLink()) {
          links.add(normalizePath(current))
          let linkTarget: string
          try {
            linkTarget = fs.readlinkSync(current)
          }
          catch (error) {
            // 链接与读取之间的删除／改指竞态按悬空目标处理，下一轮刷新会重新解析
            if (!isMissingFsError(error) && !isUnavailableSourceError(error))
              throw error
            return { target: canonicalTargetPath(path.join(current, ...parts.slice(index + 1))), exists: false, links: [...links] }
          }
          remaining = path.resolve(path.dirname(current), linkTarget, ...parts.slice(index + 1))
          redirected = true
          break
        }
      }
      catch (error) {
        if (!isMissingFsError(error) && !isUnavailableSourceError(error))
          throw error
        return { target: canonicalTargetPath(path.join(current, ...parts.slice(index + 1))), exists: false, links: [...links] }
      }
    }
    if (!redirected) {
      stat ??= fs.lstatSync(root, { bigint: true })
      return {
        target: canonicalTargetPath(current),
        exists: true,
        links: [...links],
        kind: stat.isDirectory() ? 'directory' : 'file',
        identity: `${stat.dev}:${stat.ino}`,
      }
    }
  }
  return { target: canonicalTargetPath(remaining), exists: false, links: [...links] }
}

/**
 * 发现声明目录及其嵌套链接的监听依赖
 *
 * @description 按词法入口应用过滤；同目标的别名分别保留，只有当前祖先链中的循环停止展开
 * 链接来源超过 {@link PAGE_WATCH_SOURCE_LIMIT} 时停止继续展开，页面扫描与生成不受影响
 */
export function collectPageWatchSources(roots: Iterable<string>, excluded: (source: string) => boolean): {
  directories: Map<string, SourceTarget>
  files: Map<string, SourceTarget>
  links: Set<string>
  truncated: boolean
} {
  const directories = new Map<string, SourceTarget>()
  const files = new Map<string, SourceTarget>()
  const links = new Set<string>()
  // 多个别名可以复用目录读取，但不能复用词法过滤结果
  const entries = new Map<string, Dirent[]>()
  let discovered = 0
  let truncated = false
  const visit = (source: string, target: string, ancestors: Set<string>): void => {
    if (truncated || ancestors.has(target))
      return
    const branch = new Set(ancestors).add(target)
    let children = entries.get(target)
    if (!children) {
      try {
        children = fs.readdirSync(target, { withFileTypes: true })
      }
      catch (error) {
        if (!isMissingFsError(error) && !isUnavailableSourceError(error))
          throw error
        return
      }
      entries.set(target, children)
    }
    for (const child of children) {
      if (truncated)
        return
      if (!child.isDirectory() && !child.isSymbolicLink())
        continue
      const lexical = normalizePath(path.join(source, child.name))
      if (excluded(lexical))
        continue
      if (child.isSymbolicLink()) {
        // 别名层叠会让同一物理目标被多个词法路径重复展开；预算耗尽时保留已发现来源
        if (discovered >= PAGE_WATCH_SOURCE_LIMIT) {
          truncated = true
          return
        }
        const resolved = resolveWatchTarget(lexical)
        const file = resolved.kind === 'file' || (!resolved.exists && isTargetFile(lexical))
        if (file && !isTargetFile(lexical))
          continue
        discovered++
        for (const link of resolved.links)
          links.add(link)
        if (file) {
          files.set(lexical, resolved)
        }
        else {
          directories.set(lexical, resolved)
          if (resolved.exists)
            visit(lexical, resolved.target, branch)
        }
      }
      else {
        visit(lexical, normalizePath(path.join(target, child.name)), branch)
      }
    }
  }
  for (const root of roots) {
    if (truncated)
      break
    if (excluded(root))
      continue
    const resolved = resolveWatchTarget(root)
    directories.set(root, resolved)
    for (const link of resolved.links)
      links.add(link)
    if (resolved.kind === 'directory')
      visit(root, resolved.target, new Set())
  }
  return { directories, files, links, truncated }
}
