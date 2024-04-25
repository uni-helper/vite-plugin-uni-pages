import fs from 'node:fs'
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

export function getSubPageDirs(path: string): string[] {
  const dirs = fg.sync(path, {
    onlyDirectories: true,
  })

  return dirs
}

export function checkPagesJsonFile(path: string) {
  if (!fs.existsSync(path)) {
    writeFileSync(path, JSON.stringify({ pages: [{ path: '' }] }, null, 2))
    return false
  }
  return true
}

export function writeFileSync(path: string, content: string) {
  fs.writeFileSync(path, content, { encoding: 'utf-8' })
}
