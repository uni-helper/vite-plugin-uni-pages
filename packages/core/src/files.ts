import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import { stringify as cjStringify } from 'comment-json'
import fg from 'fast-glob'

import { FILE_EXTENSIONS } from './constant'
import { extsToGlob } from './utils'

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

export function checkPagesJsonFile(path: string) {
  if (!fs.existsSync(path)) {
    writeFileSync(path, cjStringify({ pages: [{ path: '' }] }, null, 2))
    return false
  }
  return true
}

export function readFileSync(path: string) {
  try {
    return fs.readFileSync(path, { encoding: 'utf-8' })
  }
  catch {
    return ''
  }
}

export function writeFileSync(path: string, content: string) {
  fs.writeFileSync(path, content, { encoding: 'utf-8' })
}
