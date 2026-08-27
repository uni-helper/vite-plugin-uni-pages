import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withFileLock } from '../packages/core/src'

/**
 * `withFileLock` 修掉的"读-改-写"并发问题的回归测试。
 *
 * 修复前只有「写」被加锁，两个进程可能都读到 pages.json、各自算出
 * 合并结果，第二次写入会悄悄丢掉第一次写入的条件编译（#ifdef）块。
 *
 * `withFileLock` 在任务全程都拿着锁。本测试证明针对同一个文件的两
 * 个并发任务会一前一后地跑：拿着锁的时间段从不重叠。
 */
describe('withFileLock serialization', () => {
  let tmpDir: string
  let lockFile: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-lock-'))
    lockFile = path.join(tmpDir, 'pages.json')
    fs.writeFileSync(lockFile, '{}', 'utf-8')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs overlapping critical sections strictly sequentially', async () => {
    // 重叠日志：任务开始时推入名称，结束时推入 'end-名字'。如果两个
    // 任务的时间段重叠，会看到 A、B、(end A)、(end B) 的顺序；
    // 一前一后执行总是 A、(end A)、B、(end B)。
    const log: string[] = []
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const task = async (name: string) => {
      return withFileLock(lockFile, async () => {
        log.push(name)
        // 拿锁的时间足够长，保证另一个任务已经开始等锁——锁失效时
        // 重叠就能被观察到。
        await sleep(80)
        log.push(`end-${name}`)
      })
    }

    // 近乎同时启动两个任务。它们绝不能交错。
    await Promise.all([task('A'), task('B')])

    // 合法的串行化：要么 A 先 B 后，要么 B 先 A 后，绝不交错。
    const ok = log.join(',') === 'A,end-A,B,end-B' || log.join(',') === 'B,end-B,A,end-A'
    expect(ok, `critical sections overlapped: ${log.join(',')}`).toBe(true)
  })

  it('returns the task value and releases the lock for the next task', async () => {
    const first = await withFileLock(lockFile, async () => {
      return 'first-value'
    })
    // 第二个任务必须能再次获取锁（锁没有泄漏）。
    const second = await withFileLock(lockFile, async () => {
      return 'second-value'
    })

    expect(first).toBe('first-value')
    expect(second).toBe('second-value')
  })

  it('serializes a burst of concurrent callers without starving any of them', async () => {
    // 回归：dev server 启动时每个页面文件触发一个监听器 `add` 事件，
    // 几十个进程内的调用方同时抢锁。只有重试机制时，运气差的同时
    // 醒来、总错过短暂的空闲窗口并耗尽重试（"Failed to acquire
    // file lock, task aborted"）。按路径排的队列必须让每个调用方都
    // 轮得到。
    const results = await Promise.all(
      Array.from({ length: 29 }, (_, i) => withFileLock(lockFile, async () => i)),
    )

    expect(results).toEqual(Array.from({ length: 29 }, (_, i) => i))
  })

  it('keeps waiting callers running after a task throws', async () => {
    const log: string[] = []

    await Promise.all([
      withFileLock(lockFile, async () => {
        log.push('before-throw')
        throw new Error('boom')
      }).catch(() => log.push('caught')),
      withFileLock(lockFile, async () => {
        log.push('after-throw')
      }),
    ])

    expect(log).toEqual(['before-throw', 'caught', 'after-throw'])
  })
})
