import type { Dirent } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { isMissingFsError, isTargetFile } from './files'

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
    let stat: fs.Stats | undefined
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part)
      try {
        stat = fs.lstatSync(current)
        if (stat.isSymbolicLink()) {
          links.add(normalizePath(current))
          remaining = path.resolve(path.dirname(current), fs.readlinkSync(current), ...parts.slice(index + 1))
          redirected = true
          break
        }
      }
      catch (error) {
        if (!isMissingFsError(error))
          throw error
        return { target: normalizePath(path.join(current, ...parts.slice(index + 1))), exists: false, links: [...links] }
      }
    }
    if (!redirected) {
      stat ??= fs.lstatSync(root)
      return {
        target: normalizePath(current),
        exists: true,
        links: [...links],
        kind: stat.isDirectory() ? 'directory' : 'file',
        identity: `${stat.dev}:${stat.ino}`,
      }
    }
  }
  return { target: normalizePath(remaining), exists: false, links: [...links] }
}

/**
 * 发现声明目录及其嵌套链接的监听依赖
 *
 * @description 按词法入口应用过滤；同目标的别名分别保留，只有当前祖先链中的循环停止展开
 */
export function collectPageWatchSources(roots: Iterable<string>, excluded: (source: string) => boolean): {
  directories: Map<string, SourceTarget>
  files: Map<string, SourceTarget>
  links: Set<string>
} {
  const directories = new Map<string, SourceTarget>()
  const files = new Map<string, SourceTarget>()
  const links = new Set<string>()
  // 多个别名可以复用目录读取，但不能复用词法过滤结果
  const entries = new Map<string, Dirent[]>()
  const visit = (source: string, target: string, ancestors: Set<string>): void => {
    if (ancestors.has(target))
      return
    const branch = new Set(ancestors).add(target)
    let children = entries.get(target)
    if (!children) {
      try {
        children = fs.readdirSync(target, { withFileTypes: true })
      }
      catch (error) {
        if (!isMissingFsError(error))
          throw error
        return
      }
      entries.set(target, children)
    }
    for (const child of children) {
      if (!child.isDirectory() && !child.isSymbolicLink())
        continue
      const lexical = normalizePath(path.join(source, child.name))
      if (excluded(lexical))
        continue
      if (child.isSymbolicLink()) {
        const resolved = resolveWatchTarget(lexical)
        const file = resolved.kind === 'file' || (!resolved.exists && isTargetFile(lexical))
        if (file && !isTargetFile(lexical))
          continue
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
    if (excluded(root))
      continue
    const resolved = resolveWatchTarget(root)
    directories.set(root, resolved)
    for (const link of resolved.links)
      links.add(link)
    if (resolved.kind === 'directory')
      visit(root, resolved.target, new Set())
  }
  return { directories, files, links }
}
