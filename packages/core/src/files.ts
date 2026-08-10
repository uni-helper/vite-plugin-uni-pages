import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import lockfile from 'proper-lockfile'
import { globSync } from 'tinyglobby'
import { FILE_EXTENSIONS, OUTPUT_NAME } from './constant'
import { debug } from './logger'

/**
 * Resolves the files that are valid pages for the given context.
 */
export function getPageFiles(path: string, options: ResolvedOptions): string[] {
  const { exclude } = options

  const ext = FILE_EXTENSIONS.length > 1 ? `{${FILE_EXTENSIONS.join(',')}}` : (FILE_EXTENSIONS[0] || '')

  const files = globSync(`**/*.${ext}`, {
    ignore: exclude,
    onlyFiles: true,
    cwd: path,
  })

  return files
}

/**
 * Check if file is a target page file
 * Determine if the file extension is in the supported page file types list
 *
 * @param path - File path
 * @returns Whether it's a target file
 */
export function isTargetFile(path: string): boolean {
  const ext = path.split('.').pop()
  return FILE_EXTENSIONS.includes(ext!)
}

/**
 * Resolve the pages.json file path for the given project root and output dir
 *
 * @param root - Project root directory
 * @param outDir - pages.json output directory relative to root
 * @returns Absolute pages.json file path
 */
export function resolvePagesJsonPath(root: string, outDir: string): string {
  return path.join(root, outDir, OUTPUT_NAME)
}

/**
 * Ensure a pages.json file exists at the given path and is readable/writable.
 * Creates a placeholder file when missing or replaces it when unusable; the
 * placeholder is overwritten by the next pages.json generation.
 *
 * @param path - File path to check
 */
export function checkPagesJsonFileSync(path: fs.PathLike): void {
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
      createEmptyFile(path)
      return
    }

    // Check if it's a file
    const stat = fs.statSync(path)
    if (!stat.isFile()) {
      // Not a file, try to delete and recreate
      if (!unlinkFile(path)) {
        return
      }
      createEmptyFile(path)
      return
    }

    // Check read/write permissions
    try {
      fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK)
    }
    catch {
      // Insufficient permissions, try to delete and recreate
      if (!unlinkFile(path)) {
        return
      }
      createEmptyFile(path)
    }
  }
  catch {
    // Other errors occurred, try to create file
    createEmptyFile(path)
  }
}

/**
 * Run a task while holding an exclusive file lock.
 *
 * Protects the whole read-modify-write critical section. The lock is held
 * from the moment `task` starts until it resolves, so concurrent processes
 * cannot observe or overwrite a half-written state. This is required by
 * pages.json generation, where the new content depends on the current content
 * (other platforms' `#ifdef` blocks).
 *
 * @param path - File path used as the lock target
 * @param task - Async work to run inside the lock; return value is forwarded
 * @param retry - Number of retries when lock acquisition fails, defaults to 3
 * @returns The value resolved by `task`, or `undefined` if the lock could not be acquired
 */
export async function withFileLock<T>(path: string, task: () => Promise<T>, retry = 3): Promise<T | undefined> {
  if (retry <= 0) {
    debug.error(`${path} Failed to acquire file lock, task aborted`)
    return undefined
  }

  let release: (() => Promise<void>) | undefined

  try {
    try {
      release = await lockfile.lock(path, { realpath: false })
    }
    catch {
      // Failed to acquire file lock, retry after backoff
      await sleep(500)
      return withFileLock(path, task, retry - 1)
    }
    return await task()
  }
  finally {
    if (release) {
      await release() // Release file lock
    }
  }
}

/**
 * Async sleep function
 * @param ms - Sleep duration in milliseconds
 * @returns Promise resolved after the given delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
