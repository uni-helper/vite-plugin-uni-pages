import type { ResolvedOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import lockfile from 'proper-lockfile'
import { globSync } from 'tinyglobby'
import { FILE_EXTENSIONS, OUTPUT_NAME } from './constant'
import { debug } from './logger'

/**
 * 解析给定上下文下可作为有效页面的文件列表。
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
 * 检查文件是否为目标页面文件
 * 判断文件扩展名是否在支持的页面文件类型列表中
 *
 * @param path - 文件路径
 * @returns 是否为目标文件
 */
export function isTargetFile(path: string): boolean {
  const ext = path.split('.').pop()
  return FILE_EXTENSIONS.includes(ext!)
}

/**
 * 根据项目根目录与输出目录解析 pages.json 文件路径
 *
 * @param root - 项目根目录
 * @param outDir - 相对 root 的 pages.json 输出目录
 * @returns pages.json 绝对路径
 */
export function resolvePagesJsonPath(root: string, outDir: string): string {
  return path.join(root, outDir, OUTPUT_NAME)
}

/**
 * 确保给定路径存在可用的 pages.json 文件。
 *
 * 仅在文件缺失时创建占位文件；占位内容会被下一次 pages.json 生成覆写。
 * 已存在的文件绝不替换：删除它会静默破坏手写内容（只读文件在其所在
 * 目录可写时依然能被 unlink），因此已存在但非常规文件、或不可读写的
 * 路径都是必须由用户修复的硬错误（例如 `chmod u+w`）。
 *
 * @param path - 待检查的文件路径
 * @throws 路径存在但非常规文件、缺少读写权限，或缺失文件的占位内容
 *          创建失败时抛出
 */
export function checkPagesJsonFileSync(path: fs.PathLike): void {
  try {
    fs.accessSync(path, fs.constants.F_OK)
  }
  catch {
    // 文件不存在：创建占位文件。此处失败（父目录缺失、目录不可写）时
    // 带着原始错误中止生成，而不是被吞掉后继续一次残缺的运行
    fs.writeFileSync(
      path,
      JSON.stringify({ pages: [{ path: '' }] }, null, 2),
      { encoding: 'utf-8' },
    )
    return
  }

  const stats = fs.statSync(path)
  if (!stats.isFile()) {
    throw new Error(`[vite-plugin-uni-pages] ${path} exists but is not a regular file. Remove it manually if it is not needed; the plugin refuses to delete or overwrite it.`)
  }

  try {
    fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK)
  }
  catch {
    throw new Error(`[vite-plugin-uni-pages] ${path} is not readable and writable. The plugin rewrites pages.json on every run; fix the file permissions (e.g. chmod u+w) or remove the read-only flag. The plugin refuses to delete and recreate the file because that would lose its content.`)
  }
}

/**
 * 按文件路径组织的进程内 FIFO 锁区段队列。
 *
 * 同进程的调用方在这里排队，不去争抢 OS 级锁，因此不会互相饿死
 * （基于重试的争抢会丢掉那些同时醒来却总错过短暂空闲窗口的调用方，
 * 例如 dev server 启动时监听器 `add` 事件的一阵爆发）。下方的 OS 级
 * 锁仍然负责防御其他进程。
 */
const lockQueues = new Map<string, Promise<unknown>>()

/**
 * 在持有排他文件锁的前提下运行任务。
 *
 * 保护整个读-改-写临界区。锁从 `task` 开始那一刻持有到其 resolve，
 * 并发进程因此无法观察到或覆写半写入状态。pages.json 生成依赖这一
 * 点：新内容取决于当前内容（其他平台的 `#ifdef` 块）。
 *
 * 同进程调用方在触碰 OS 级锁之前先由按路径的 FIFO 队列串行化；下方
 * 的重试/退避只防御其他进程。
 *
 * @param path - 作为锁目标的文件路径
 * @param task - 在锁内运行的异步任务；返回值原样透传
 * @param retry - 获取锁失败时的重试次数，默认 3
 * @returns `task` resolve 的值；获取不到锁时为 `undefined`
 */
export function withFileLock<T>(path: string, task: () => Promise<T>, retry = 3): Promise<T | undefined> {
  // 接在上一区段完成后（吞掉其结果，失败的前任不会连累后续者），
  // 按 FIFO 顺序运行。Map 以锁目标为键，目标只有寥寥几个，无需清理。
  const previous = lockQueues.get(path) ?? Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(() => acquireAndRun(path, task, retry))
  lockQueues.set(path, current)
  return current
}

/** 获取 OS 级锁（对其他进程重试）并运行任务 */
async function acquireAndRun<T>(path: string, task: () => Promise<T>, retry: number): Promise<T | undefined> {
  for (let attempt = retry; attempt > 0; attempt--) {
    let release: (() => Promise<void>) | undefined
    try {
      release = await lockfile.lock(path, { realpath: false })
    }
    catch {
      // 其他进程持有锁，退避后重试
      await sleep(500)
      continue
    }

    try {
      return await task()
    }
    finally {
      await release() // 释放文件锁
    }
  }

  debug.error(`${path} Failed to acquire file lock, task aborted`)
  return undefined
}

/**
 * 异步休眠函数
 * @param ms - 休眠毫秒数
 * @returns 指定延时后 resolve 的 Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
