import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import lockfile from 'proper-lockfile'
import { globSync } from 'tinyglobby'
import writeFileAtomic from 'write-file-atomic'
import { FILE_EXTENSIONS } from './constant'
import { debug, extsToGlob, sleep } from './utils'
/**
 * Resolves the files that are valid pages for the given context.
 */
export function getPageFiles(path: string, options: ResolvedOptions): string[] {
  const { exclude } = options

  const ext = extsToGlob(FILE_EXTENSIONS)

  const files = globSync(`**/*.${ext}`, {
    ignore: exclude,
    onlyFiles: true,
    cwd: path,
  })

  return files
}

/**
 * Check the pages.json file at the specified path, create an empty pages.json file if it doesn't exist or is not a valid file
 * @param path - File path to check
 * @returns boolean - Whether the operation was successful
 */
export function checkPagesJsonFileSync(path: fs.PathLike): boolean {
  /**
   * Create an empty pages.json file
   * @param path - File path
   * @returns boolean - Whether the creation was successful
   */
  const createEmptyFile = (path: fs.PathLike): boolean => {
    try {
      fs.writeFileSync(
        path,
        JSON.stringify({ pages: [{ path: '' }] }, null, 2),
        { encoding: 'utf-8' },
      )
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Delete the file at the specified path
   * @param path - File path
   * @returns boolean - Whether the deletion was successful
   */
  const unlinkFile = (path: fs.PathLike): boolean => {
    try {
      fs.unlinkSync(path)
      return true
    }
    catch {
      return false
    }
  }

  try {
    // Check if file exists
    try {
      fs.accessSync(path, fs.constants.F_OK)
    }
    catch {
      // File does not exist, create new file
      return createEmptyFile(path)
    }

    // Check if it's a file
    const stat = fs.statSync(path)
    if (!stat.isFile()) {
      // Not a file, try to delete and recreate
      if (!unlinkFile(path)) {
        return false
      }
      return createEmptyFile(path)
    }

    // Check read/write permissions
    try {
      fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK)

      return true
    }
    catch {
      // Insufficient permissions, try to delete and recreate
      if (!unlinkFile(path)) {
        return false
      }
      return createEmptyFile(path)
    }
  }
  catch {
    // Other errors occurred, try to create file
    return createEmptyFile(path)
  }
}

/**
 * Safely write file using file lock
 * Avoid data corruption caused by concurrent writes through file lock
 * Use atomic write to ensure file write integrity
 *
 * @param path - File path
 * @param content - File content
 * @param retry - Number of retries when lock acquisition fails, defaults to 3
 */
export async function writeFileWithLock(path: string, content: string, retry = 3) {
  if (retry <= 0) {
    debug.error(`${path} Failed to acquire file lock, write failed`)
    return
  }

  let release: () => Promise<void> | undefined

  try {
    try {
      // Acquire file lock
      release = await lockfile.lock(path, { realpath: false })
    }
    catch {
      // Failed to acquire file lock
      await sleep(500)
      return writeFileWithLock(path, content, retry - 1)
    }
    // Use atomic write
    await writeFileAtomic(path, content)
  }
  finally {
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error'
    if (release) {
      await release() // Release file lock
    }
  }
}
