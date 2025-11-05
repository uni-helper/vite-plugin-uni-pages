import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import fg from 'fast-glob'
import lockfile from 'proper-lockfile'
import { FILE_EXTENSIONS } from './constant'
import { debug, extsToGlob, sleep } from './utils'

/**
 * Resolves the files that are valid pages for the given context.
 */
export function getPageFiles(path: string, options: ResolvedOptions): string[] {
  const { exclude } = options

  const ext = extsToGlob(FILE_EXTENSIONS)

  // 分离排除规则中的否定模式（以!开头的规则）
  const positivePatterns = exclude.filter(pattern => !pattern.startsWith('!'))
  const negativePatterns = exclude.filter(pattern => pattern.startsWith('!'))
    .map(pattern => pattern.slice(1)) // 移除!前缀

  // 先获取所有匹配的文件
  let files = fg.sync(`**/*.${ext}`, {
    ignore: positivePatterns, // 只使用肯定模式进行初始过滤
    onlyFiles: true,
    cwd: path,
  })

  // 如果有否定模式（即应该包含的模式），需要特殊处理
  if (negativePatterns.length > 0) {
    // 获取所有应该包含的文件
    const includedFiles = fg.sync(negativePatterns.map(pattern => `${pattern}`), {
      onlyFiles: true,
      cwd: path,
    })

    // 将应该包含的文件添加回结果集，确保不重复
    const filesSet = new Set([...files, ...includedFiles])
    files = Array.from(filesSet)
  }

  return files
}

/**
 * 检查指定路径的 pages.json 文件，如果文件不存在或不是有效文件则创建一个空的 pages.json 文件
 * @param path - 要检查的文件路径
 * @returns boolean - 返回操作是否成功
 */
export function checkPagesJsonFileSync(path: fs.PathLike): boolean {
  /**
   * 创建空的 pages.json 文件
   * @param path - 文件路径
   * @returns boolean - 返回创建是否成功
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
   * 删除指定路径的文件
   * @param path - 文件路径
   * @returns boolean - 返回删除是否成功
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
    // 检查文件是否存在
    try {
      fs.accessSync(path, fs.constants.F_OK)
    }
    catch {
      // 文件不存在，创建新文件
      return createEmptyFile(path)
    }

    // 检查是否为文件
    const stat = fs.statSync(path)
    if (!stat.isFile()) {
      // 不是文件，尝试删除并重新创建
      if (!unlinkFile(path)) {
        return false
      }
      return createEmptyFile(path)
    }

    // 检查读写权限
    try {
      fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK)

      return true
    }
    catch {
      // 权限不足，尝试删除并重新创建
      if (!unlinkFile(path)) {
        return false
      }
      return createEmptyFile(path)
    }
  }
  catch {
    // 发生其他错误，尝试创建文件
    return createEmptyFile(path)
  }
}

export async function writeFileWithLock(path: string, content: string, retry = 3) {
  if (retry <= 0) {
    debug.error(`${path} 获取文件锁失败，写入失败`)
    return
  }

  let release: () => Promise<void> | undefined

  try {
    try {
      // 获取文件锁
      release = await lockfile.lock(path, { realpath: false })
    }
    catch {
      // 获取文件锁失败
      await sleep(500)
      return writeFileWithLock(path, content, retry - 1)
    }
    await fs.promises.writeFile(path, content, { encoding: 'utf-8' }) // 执行写入操作
  }
  finally {
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error'
    if (release) {
      await release() // 释放文件锁
    }
  }
}
