import process from 'node:process'
import { slash } from '@antfu/utils'
import fg from 'fast-glob'
import type { LoadConfigSource } from 'unconfig'
import type { ResolvedOptions, UserOptions } from './types'
import type { PagesConfig } from './config'

export function resolveOptions(userOptions: UserOptions, viteRoot?: string): ResolvedOptions {
  const {
    configSource = 'pages.config',
    homePage = ['pages/index', 'pages/index/index'],
    mergePages = true,
    dir = 'src/pages',
    subPackages = [],

    outDir = 'src',
    exclude = ['node_modules', '.git', '**/__*__/**'],
    routeBlockLang = 'json5',
    minify = false,
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

  const root = viteRoot || slash(process.cwd())
  const resolvedDirs = resolvePageDirs(dir, root, exclude)
  const resolvedSubDirs = subPackages.map(dir => slash(dir))
  const resolvedHomePage = typeof homePage === 'string' ? [homePage] : homePage
  const resolvedConfigSource = typeof configSource === 'string' ? [{ files: configSource } as LoadConfigSource<PagesConfig>] : configSource

  const resolvedOptions: ResolvedOptions = {
    configSource: Array.isArray(resolvedConfigSource) ? resolvedConfigSource : [resolvedConfigSource],
    homePage: resolvedHomePage,
    mergePages,
    dirs: resolvedDirs,
    subPackages: resolvedSubDirs,
    outDir,
    exclude,
    routeBlockLang,
    root,
    minify,
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
 * Resolves the page dirs for its for its given globs
 */
export function resolvePageDirs(dir: string, root: string, exclude: string[]): string[] {
  const dirs = fg.sync(slash(dir), {
    ignore: exclude,
    onlyDirectories: true,
    dot: true,
    unique: true,
    cwd: root,
  })
  return dirs
}
