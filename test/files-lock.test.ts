import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withFileLock } from '../packages/core/src'

/**
 * Regression coverage for the read-modify-write race fixed by `withFileLock`.
 *
 * Before the fix, only the *write* was locked, so two processes could both
 * read pages.json, compute their own merge result, and the second write would
 * silently drop the first one's conditional-compilation (#ifdef) blocks.
 *
 * `withFileLock` holds the lock across the whole critical section. This test
 * proves two concurrent tasks targeting the same file are serialized: their
 * critical sections never overlap.
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
    // Overlap log: push the section name when it starts, push 'END' when it ends.
    // If two sections ever overlapped, we would see A, B, (end A), (end B)
    // ordering. Sequential execution always yields A, (end A), B, (end B).
    const log: string[] = []
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const task = async (name: string) => {
      return withFileLock(lockFile, async () => {
        log.push(name)
        // Hold the lock long enough to guarantee the other task has started
        // waiting on it, so overlap would be observable if the lock failed.
        await sleep(80)
        log.push(`end-${name}`)
      })
    }

    // Kick both off near-simultaneously. They must NOT interleave.
    await Promise.all([task('A'), task('B')])

    // Valid serializations: either A-then-B or B-then-A, never interleaved.
    const ok = log.join(',') === 'A,end-A,B,end-B' || log.join(',') === 'B,end-B,A,end-A'
    expect(ok, `critical sections overlapped: ${log.join(',')}`).toBe(true)
  })

  it('returns the task value and releases the lock for the next task', async () => {
    const first = await withFileLock(lockFile, async () => {
      return 'first-value'
    })
    // A second task must be able to acquire the lock again (no leaked lock).
    const second = await withFileLock(lockFile, async () => {
      return 'second-value'
    })

    expect(first).toBe('first-value')
    expect(second).toBe('second-value')
  })
})
