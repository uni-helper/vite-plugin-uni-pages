import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import type { ResolvedOptions, UserOptions } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { resolvePageDirs, resolveSubPackageDirs } from './directories'

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

  const root = viteRoot || normalizePath(process.env.VITE_ROOT_DIR || process.cwd())
  const resolvedDirs = resolvePageDirs(dir, root, exclude)

  const resolvedSubPackages = resolveSubPackageDirs(subPackages, root, outDir, exclude)

  const resolvedHomePage = typeof homePage === 'string' ? [homePage] : homePage
  const resolvedConfigSource = typeof configSource === 'string' ? [{ files: configSource } as LoadConfigSource<PagesConfig>] : configSource
  const resolvedDts = !dts ? false : typeof dts === 'string' ? dts : resolve(viteRoot, 'uni-pages.d.ts')

  const resolvedOptions: ResolvedOptions = {
    dts: resolvedDts,
    configSource: Array.isArray(resolvedConfigSource) ? resolvedConfigSource : [resolvedConfigSource],
    homePage: resolvedHomePage,
    mergePages,
    dir,
    dirs: resolvedDirs,
    subPackagePatterns: subPackages,
    ...resolvedSubPackages,
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
