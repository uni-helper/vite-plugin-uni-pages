import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import fg from 'fast-glob'

import { normalizePath } from 'vite'
import { EMPTY_PAGES_JSON_CONTENTS, FILE_EXTENSIONS } from './constant'
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

/**
 * 检查指定路径的pages.json文件，如果文件不存在或不是有效文件则创建一个空的pages.json文件
 * @param path - 要检查的文件路径
 * @returns Promise<void> - 无返回值的异步函数
 */
export async function checkPagesJsonFile(path: fs.PathLike, contents: string = EMPTY_PAGES_JSON_CONTENTS): Promise<boolean> {
  const createEmptyFile = (path: fs.PathLike) => {
    return fs.promises.writeFile(path, contents, { encoding: 'utf-8' }).then(() => true).catch(() => false)
  }

  const unlink = (path: fs.PathLike) => {
    return fs.promises.unlink(path).then(() => true).catch(() => false)
  }

  try {
    const stat = await fs.promises.stat(path)

    if (!stat.isFile()) {
      // 不是文件，尝试删除
      if (!await unlink(path)) {
        return false
      }

      return createEmptyFile(path) // 创建空文件
    }
    // 是文件

    const access = await fs.promises.access(path, fs.constants.W_OK | fs.constants.R_OK).then(() => true).catch(() => false)
    if (!access) {
      // 无权限，尝试删除
      if (!await unlink(path)) {
        return false
      }

      return createEmptyFile(path) // 创建空文件
    }
    return true
  }
  catch {
    // stat 出错，证明没此文件
    return createEmptyFile(path) // 创建空文件
  }
}

export function setupPagesJsonFile(path: string) {
  const _readFileSync = fs.readFileSync
  fs.readFileSync = new Proxy(fs.readFileSync, {
    apply(target, thisArg, argArray) {
      if (typeof argArray[0] === 'string' && normalizePath(argArray[0]) === normalizePath(path)) {
        try {
          const data = _readFileSync.apply(thisArg, argArray as any)
          fs.readFileSync = _readFileSync
          return data
        }
        catch {
          checkPagesJsonFile(path).then(() => {
            fs.readFileSync = _readFileSync
          })
        }
        return EMPTY_PAGES_JSON_CONTENTS
      }
      return Reflect.apply(target, thisArg, argArray)
    },
  })
}
