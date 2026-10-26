import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withFileLock } from '../packages/core/src/files'

/**
 * `withFileLock` 对拿锁错误的分类。
 *
 * 只有 ELOCKED（锁被其他进程拿着）值得等待重试。权限不足、父目录缺失
 * 之类的错误重试也不会成功，以前会被吞掉并统一报成“拿不到锁”，用户
 * 看不到真实的 EACCES，修复方向也就被误导了。
 */

// proper-lockfile 是 packages/core 的依赖，仓库根目录解析不到；用 core 的
// 位置取到同一个导出对象再监听 lock，files.ts 调用时才取属性
const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const lock = vi.spyOn(require('proper-lockfile') as { lock: (...args: unknown[]) => Promise<() => Promise<void>> }, 'lock')

function lockError(code: string): Error {
  return Object.assign(new Error(`lock failed: ${code}`), { code })
}

describe('withFileLock error classification', () => {
  beforeEach(() => {
    lock.mockReset()
  })

  it('retries lock contention and runs the task once', async () => {
    lock
      .mockRejectedValueOnce(lockError('ELOCKED'))
      .mockResolvedValueOnce(async () => {})
    const task = vi.fn(async () => 'value')

    await expect(withFileLock('/tmp/uni-pages-lock-retry/pages.json', task, 2)).resolves.toBe('value')
    expect(lock).toHaveBeenCalledTimes(2)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last contention without waiting for another round', async () => {
    lock.mockRejectedValue(lockError('ELOCKED'))
    const task = vi.fn()

    await expect(withFileLock('/tmp/uni-pages-lock-exhausted/pages.json', task, 1)).resolves.toBeUndefined()
    expect(lock).toHaveBeenCalledTimes(1)
    expect(task).not.toHaveBeenCalled()
  })

  it.each(['EACCES', 'ENOENT'])('propagates %s instead of reporting contention', async (code) => {
    lock.mockRejectedValue(lockError(code))
    const task = vi.fn()

    await expect(withFileLock(`/tmp/uni-pages-lock-${code}/pages.json`, task)).rejects.toMatchObject({ code })
    expect(lock).toHaveBeenCalledTimes(1)
    expect(task).not.toHaveBeenCalled()
  })

  it('propagates errors without a code instead of retrying them', async () => {
    lock.mockRejectedValue(new Error('unexpected lock failure'))
    const task = vi.fn()

    await expect(withFileLock('/tmp/uni-pages-lock-unknown/pages.json', task)).rejects.toThrow('unexpected lock failure')
    expect(lock).toHaveBeenCalledTimes(1)
  })
})
