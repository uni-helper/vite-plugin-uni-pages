import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import type { ResolvedOptions, UserOptions } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { slash } from '@antfu/utils'
import { globSync } from 'tinyglobby'

/**
 * 解析用户配置项
 * 将用户提供的配置与默认值合并，并处理路径解析
 *
 * @param userOptions - 用户配置项
 * @param viteRoot - Vite 项目根目录
 * @returns 解析后的配置项
 */
export function resolveOptions(userOptions: UserOptions, viteRoot: string = process.cwd()): ResolvedOptions {
  const {
    dts = true,
    configSource = 'pages.config',
    homePage = ['pages/index', 'pages/index/index'],
    mergePages = true,
    dir = 'src/pages',
    subPackages = [],

    outDir = 'src',
    exclude = ['node_modules', '.git', '**/__*__/**'],
    minify = false,
    insertFinalNewline = false,
    indent = 2,
    eol = '\n',
    debug = false,

    onBeforeLoadUserConfig = () => {},
    onAfterLoadUserConfig = () => {},
    onBeforeScanPages = () => {},
    onAfterScanPages = () => {},
    onBeforeMergePageMetaData = () => {},
    onAfterMergePageMetaData = () => {},
    onBeforeWriteFile = () => {},
    onAfterWriteFile = () => {},
  } = userOptions

  const root = viteRoot || slash(process.env.VITE_ROOT_DIR || process.cwd())
  const resolvedDirs = resolvePageDirs(dir, root, exclude)

  // 处理 subPackages：同时支持字符串和 SubPackageConfig 两种格式。
  // monorepo 项目里，用户可能需要在 pages.json 中使用自定义 root 路径，
  // 而不是自动生成带 '..' 的相对路径
  const subPackageRootMap = new Map<string, string>()
  const resolvedSubDirs: string[] = []
  for (const sub of subPackages) {
    if (typeof sub === 'string') {
      resolvedSubDirs.push(slash(sub))
    }
    else {
      const dirPath = slash(sub.dir)
      resolvedSubDirs.push(dirPath)
      // 记录物理目录到 pages.json 自定义 root 的映射
      subPackageRootMap.set(dirPath, sub.root)
    }
  }

  const resolvedHomePage = typeof homePage === 'string' ? [homePage] : homePage
  const resolvedConfigSource = typeof configSource === 'string' ? [{ files: configSource } as LoadConfigSource<PagesConfig>] : configSource
  const resolvedDts = !dts ? false : typeof dts === 'string' ? dts : resolve(viteRoot, 'uni-pages.d.ts')

  const resolvedOptions: ResolvedOptions = {
    dts: resolvedDts,
    configSource: Array.isArray(resolvedConfigSource) ? resolvedConfigSource : [resolvedConfigSource],
    homePage: resolvedHomePage,
    mergePages,
    dirs: resolvedDirs,
    subPackages: resolvedSubDirs,
    subPackageRootMap,
    outDir,
    exclude,
    root,
    minify,
    insertFinalNewline,
    indent,
    eol,
    debug,
    onBeforeLoadUserConfig,
    onAfterLoadUserConfig,
    onBeforeScanPages,
    onAfterScanPages,
    onBeforeMergePageMetaData,
    onAfterMergePageMetaData,
    onBeforeWriteFile,
    onAfterWriteFile,
  }

  return resolvedOptions
}

/**
 * 根据给定的 glob 模式解析页面目录
 * @param dir - 页面目录 glob 模式
 * @param root - 项目根目录
 * @param exclude - 需要排除的 glob 模式
 * @returns 匹配到的目录路径
 */
export function resolvePageDirs(dir: string, root: string, exclude: string[]): string[] {
  const dirs = globSync(slash(dir), {
    ignore: exclude,
    onlyDirectories: true,
    expandDirectories: false,
    dot: true,
    cwd: root,
  })
  return dirs
}
