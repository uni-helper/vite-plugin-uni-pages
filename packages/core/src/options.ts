import { slash } from '@antfu/utils'
import fg from 'fast-glob'
import type { ResolvedOptions, UserOptions } from './types'

export function resolveOptions(userOptions: UserOptions, viteRoot?: string): ResolvedOptions {
  const {
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

  const resolvedOptions: ResolvedOptions = {
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
