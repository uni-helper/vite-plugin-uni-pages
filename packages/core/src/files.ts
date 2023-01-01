import fg from 'fast-glob'
import { extsToGlob } from './utils'

import type { ResolvedOptions } from './types'
import { FILE_EXTENSIONS } from './constant'

/**
 * Resolves the files that are valid pages for the given context.
 */
export function getPageFiles(path: string, options: ResolvedOptions): string[] {
  const { exclude } = options

  const ext = extsToGlob(FILE_EXTENSIONS)

  const files = fg.sync(`**/*.${ext}`, {
    ignore: exclude,
    onlyFiles: true,
    cwd: path,
  })

  return files
}
