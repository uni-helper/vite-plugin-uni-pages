import { slash } from '@antfu/utils'
import fg from 'fast-glob'
import type { ResolvedOptions, UserOptions } from './types'

export function resolveOptions(userOptions: UserOptions, viteRoot?: string): ResolvedOptions {
  const {
    dir = 'src/pages',
    outDir = 'src',
    exclude = ['node_modules', '.git', '**/__*__/**'],
    routeBlockLang = 'json5',

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

  const resolvedOptions: ResolvedOptions = {
    dirs: resolvedDirs,
    outDir,
    exclude,
    routeBlockLang,
    root,
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
