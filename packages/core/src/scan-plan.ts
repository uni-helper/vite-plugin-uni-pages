import type { SubPackageDirectorySource } from './directories'
import type { PageRules } from './page-rules'
import type { ResolvedOptions } from './types'
import path from 'node:path'
import { normalizePath } from 'vite'
import { discoverSubPackageDirectories, resolvePageDirs } from './directories'
import { getPageRules } from './page-rules'

/**
 * 一轮扫描使用的不可变目录视图。
 *
 * 主包目录、分包来源、最终 root 与词法规则来自同一次发现；页面扫描、
 * 监听和事件判定都消费这份值，不再各自从 ResolvedOptions 推导。
 */
export interface ScanPlan {
  root: string
  /** pages.json 页面路径的解析基准（root + outDir） */
  basePath: string
  /** 主包待扫描目录，相对 root */
  mainDirs: readonly string[]
  /** 分包待扫描目录投影，相对 root */
  subPackageDirs: readonly string[]
  /** 逐条分包声明来源，保留显式 root、规则位置与物理身份 */
  subPackageSources: readonly SubPackageDirectorySource[]
  /** 目录到最终分包 root 的映射 */
  subPackageRootMap: ReadonlyMap<string, string>
  /** 以 root 为基准编译的目录与排除规则 */
  rules: PageRules
}

/** 发现当前声明对应的扫描计划；目录、身份与回调都在这里刷新 */
export function createScanPlan(options: ResolvedOptions): ScanPlan {
  const { sources, projection } = discoverSubPackageDirectories(
    options.subPackagePatterns,
    options.root,
    options.outDir,
    options.exclude,
  )

  return {
    root: options.root,
    basePath: normalizePath(path.join(options.root, options.outDir)),
    mainDirs: resolvePageDirs(options.dir, options.root, options.exclude).map(dir => dir.replace(/\/$/, '')),
    subPackageDirs: projection.subPackages,
    subPackageSources: sources,
    subPackageRootMap: new Map(projection.subPackageRootMap),
    rules: getPageRules(options),
  }
}

/**
 * 把计划同步回 ResolvedOptions。
 *
 * `dirs`、`subPackages` 与 `subPackageRootMap` 是给既有调用方和测试看的
 * 兼容投影；内部扫描与监听应读取 ScanPlan，而不是这些字段。
 */
export function applyScanPlan(options: ResolvedOptions, plan: ScanPlan): void {
  options.dirs = [...plan.mainDirs]
  options.subPackages = [...plan.subPackageDirs]
  options.subPackageRootMap = new Map(plan.subPackageRootMap)
}
