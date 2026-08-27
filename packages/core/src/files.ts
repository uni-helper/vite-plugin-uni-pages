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
 * 确保这个路径上有一个能用的 pages.json 文件。
 *
 * 文件不存在时创建一个占位文件，占位内容很快会被下一次生成覆盖。
 * 已存在的文件绝不删除重建：删它会悄悄弄丢手写的内容（只读的文件
 * 也能被删除，只要它所在的目录可写），所以"路径存在但不是普通文件、
 * 或者读不了也写不了"都算必须由用户自己修的硬错误（例如
 * `chmod u+w`）。
 *
 * @param path - 待检查的文件路径
 * @throws 路径存在但不是普通文件、缺少读写权限，或占位文件创建失败时
 *          抛出
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
 * 同一个进程里按文件路径排的等待队列（先来后到）。
 *
 * 同进程的调用方先在这里排队，不直接去抢 OS 锁：抢锁靠不断重试，
 * 可能有人运气差总抢不到（比如 dev server 启动时监听器 `add` 事件
 * 一拥而上）。排队保证人人都轮得到。下面的 OS 锁负责挡住其他进程。
 */
const lockQueues = new Map<string, Promise<unknown>>()

/**
 * 拿到文件的独占锁后运行任务，运行完自动放锁。
 *
 * 它保护"读文件 → 算新内容 → 写回"的整个过程：锁从 `task` 开始
 * 一直拿到它结束，别的进程看不到、也覆盖不了写了一半的文件。
 * pages.json 的生成靠这一点：新内容要根据当前文件来算（里面有其他
 * 平台的 `#ifdef` 块）。
 *
 * 同进程的调用方先在上面那条按路径的队列里排队，再碰 OS 锁；下面的
 * 重试只用来等其他进程放锁。
 *
 * @param path - 要加锁的文件路径
 * @param task - 在锁内运行的异步任务；返回值原样返回给调用方
 * @param retry - 锁被别人拿着时的重试次数，默认 3
 * @returns `task` 的结果；一直拿不到锁时为 `undefined`
 */
export function withFileLock<T>(path: string, task: () => Promise<T>, retry = 3): Promise<T | undefined> {
  // 排在上一个人做完后开始（忽略他的成败，失败的前一个不会拖累后
  // 一个），保证先来后到。Map 用文件路径当键，要加锁的文件就几个，
  // 不用清理
  const previous = lockQueues.get(path) ?? Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(() => acquireAndRun(path, task, retry))
  lockQueues.set(path, current)
  return current
}

/** 去拿 OS 级的锁（拿不到就等一会儿再试，防的是其他进程），拿到后运行任务 */
async function acquireAndRun<T>(path: string, task: () => Promise<T>, retry: number): Promise<T | undefined> {
  for (let attempt = retry; attempt > 0; attempt--) {
    let release: (() => Promise<void>) | undefined
    try {
      release = await lockfile.lock(path, { realpath: false })
    }
    catch {
      // 锁被别的进程拿着，等半秒再试
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
