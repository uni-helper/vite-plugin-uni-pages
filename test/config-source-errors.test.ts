import fs from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { PagesConfigLoader } from '../packages/core/src/config-loader'
import { createFixture } from './helpers/fixture'

afterEach(() => vi.unstubAllGlobals())

it('定位说明不能用只读 stack 的写入错误替换配置异常', async () => {
  const fixture = createFixture('uni-pages-config-error-')
  const original = new Error('config failed')
  const stack = original.stack
  Object.defineProperty(original, 'stack', { value: stack, writable: false })
  vi.stubGlobal('__uniPagesConfigError', original)
  fixture.write('pages.config.ts', `throw globalThis.__uniPagesConfigError; export default {}`)

  await expect(new PagesConfigLoader(fixture.root).load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toBe(original)
  expect(original.stack).toBe(stack)
  expect(fs.readdirSync(fixture.path('node_modules/.cache/uni-pages'))).toEqual([])
})

it.each([false, true])('执行异常的说明只写入一次，stack 已读取：%s', async (cached) => {
  const fixture = createFixture('uni-pages-config-error-')
  let original: Error | undefined
  let stack: string | undefined
  vi.stubGlobal('__uniPagesCaptureError', (error: Error) => {
    original = error
    if (cached)
      stack = error.stack
  })
  fixture.write('pages.config.ts', `
    const error = new Error('config failed')
    globalThis.__uniPagesCaptureError(error)
    throw error
    export default {}
  `)

  const error = await new PagesConfigLoader(fixture.root).load([{ files: 'pages.config.ts', extensions: [] }]).then(() => undefined, (error: Error) => error)
  const note = 'The error happened while evaluating the config generated from pages.config.ts'
  expect(error).toBe(original)
  expect(error?.message.match(/The error happened/g)).toHaveLength(1)
  expect(error?.stack?.match(/The error happened/g)).toHaveLength(1)
  expect(error?.message).toContain(note)
  expect(error?.stack).toContain(note)
  if (cached)
    expect(error?.stack).toContain(stack)
  expect(fs.readdirSync(fixture.path('node_modules/.cache/uni-pages'))).toEqual([])
})

it('stack 访问器抛错时保留原配置异常并清理产物', async () => {
  const fixture = createFixture('uni-pages-config-error-')
  const original = new Error('config failed')
  const getStack = vi.fn(() => {
    throw new Error('stack unavailable')
  })
  Object.defineProperty(original, 'stack', { get: getStack })
  vi.stubGlobal('__uniPagesConfigError', original)
  fixture.write('pages.config.ts', `throw globalThis.__uniPagesConfigError; export default {}`)

  await expect(new PagesConfigLoader(fixture.root).load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toBe(original)
  expect(original.message).toBe('config failed')
  expect(Object.getOwnPropertyDescriptor(original, 'stack')?.get).toBe(getStack)
  expect(getStack).toHaveBeenCalledOnce()
  expect(fs.readdirSync(fixture.path('node_modules/.cache/uni-pages'))).toEqual([])
})

it.each([null, 'config failed', Object.freeze({ reason: 'config failed' })])('非 Error 异常保持原值并清理产物：%j', async (original) => {
  const fixture = createFixture('uni-pages-config-error-')
  vi.stubGlobal('__uniPagesConfigError', original)
  fixture.write('pages.config.ts', `throw globalThis.__uniPagesConfigError; export default {}`)

  await expect(new PagesConfigLoader(fixture.root).load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toBe(original)
  expect(fs.readdirSync(fixture.path('node_modules/.cache/uni-pages'))).toEqual([])
})
