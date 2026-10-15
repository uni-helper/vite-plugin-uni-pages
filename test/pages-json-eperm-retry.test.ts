import { expect, it } from 'vitest'
import { retryOnEperm } from '../packages/core/src/pages-json'

/**
 * retryOnEperm retries on EPERM and propagates after exhausting all attempts.
 *
 * Windows: chokidar may hold pages.json open with a sharing mode that blocks
 * write-file-atomic's rename. The fix retries up to 3 times (50ms apart).
 */

it('retries on EPERM and succeeds when the lock clears', async () => {
  const eperm = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
  let calls = 0
  await retryOnEperm(async () => {
    calls++
    if (calls === 1)
      throw eperm
  })
  expect(calls).toBe(2)
})

it('propagates EPERM after exhausting all retries', async () => {
  const eperm = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
  const alwaysFail = async (): Promise<void> => {
    throw eperm
  }
  await expect(retryOnEperm(alwaysFail)).rejects.toThrow('EPERM')
})

it('does not retry non-EPERM errors', async () => {
  const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  let calls = 0
  const failOnce = async (): Promise<void> => {
    calls++
    throw enoent
  }
  await expect(retryOnEperm(failOnce)).rejects.toThrow('ENOENT')
  expect(calls).toBe(1)
})
