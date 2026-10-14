import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src/context'

let root: string
let ctx: PageContext
let updates: MockInstance<PageContext['updatePagesJSON']>
const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
const write = (file: string, content: string): void => fs.writeFileSync(path.join(root, file), content)
const config = (dependency: string): string => `import { title } from './${dependency}'; export default { globalStyle: { navigationBarTitleText: title } }`

function outputTitle(): string {
  const output = parse<{ globalStyle: { navigationBarTitleText: string } }>(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8'))
  return output.globalStyle.navigationBarTitleText
}

async function dispatch(event: 'add' | 'change', file: string): Promise<PromiseSettledResult<boolean>[]> {
  updates.mockClear()
  watcher.emit(event, path.join(root, file))
  return Promise.allSettled(updates.mock.results.map(result => result.value))
}

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-recovery-watch-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  write('package.json', '{"type":"module"}')
  write('src/pages/index.vue', '<template><view/></template>')
  write('leaf.ts', `export const title = 'initial'`)
  write('pages.config.ts', config('leaf.ts'))
  ctx = new PageContext({ dts: false }, root, 'h5')
  updates = vi.spyOn(ctx, 'updatePagesJSON')
  await ctx.updatePagesJSON()
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
})

afterEach(async () => {
  await ctx.disposeWatchers()
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('连续失败后的配置恢复监听', () => {
  it.each(['a.ts', 'a/custom.ts'])('连续编译失败后忽略旧恢复文件 %s，保留当前恢复能力', async (obsoleteFile) => {
    write('pages.config.ts', config('a'))
    expect(await dispatch('change', 'pages.config.ts')).toMatchObject([{ status: 'rejected' }])
    write('pages.config.ts', config('b'))
    expect(await dispatch('change', 'pages.config.ts')).toMatchObject([{ status: 'rejected' }])
    expect(outputTitle()).toBe('initial')

    fs.mkdirSync(path.dirname(path.join(root, obsoleteFile)), { recursive: true })
    write(obsoleteFile, `export const title = 'obsolete'`)
    expect(await dispatch('add', obsoleteFile)).toEqual([])

    write('leaf.ts', `export const title = 'previous'`)
    expect(await dispatch('change', 'leaf.ts')).toMatchObject([{ status: 'rejected' }])
    expect(outputTitle()).toBe('initial')

    write('b.ts', `export const title = 'recovered'`)
    expect(await dispatch('add', 'b.ts')).toEqual([{ status: 'fulfilled', value: true }])
    expect(outputTitle()).toBe('recovered')
    expect(await dispatch('change', 'leaf.ts')).toEqual([])
    expect(await dispatch('change', obsoleteFile)).toEqual([])
  })

  it.each([
    { failure: '语法', code: 'export const title =' },
    { failure: '执行', code: `export const title = 'broken'; throw new Error('runtime failure')` },
  ])('连续$failure失败后忽略旧失败依赖，保留当前依赖的恢复能力', async ({ code }) => {
    write('a.ts', code)
    write('pages.config.ts', config('a.ts'))
    expect(await dispatch('change', 'pages.config.ts')).toMatchObject([{ status: 'rejected' }])
    write('b.ts', code)
    write('pages.config.ts', config('b.ts'))
    expect(await dispatch('change', 'pages.config.ts')).toMatchObject([{ status: 'rejected' }])
    expect(outputTitle()).toBe('initial')

    write('a.ts', `export const title = 'obsolete'`)
    expect(await dispatch('change', 'a.ts')).toEqual([])
    write('leaf.ts', `export const title = 'previous'`)
    expect(await dispatch('change', 'leaf.ts')).toMatchObject([{ status: 'rejected' }])
    expect(outputTitle()).toBe('initial')

    write('b.ts', `export const title = 'recovered'`)
    expect(await dispatch('change', 'b.ts')).toEqual([{ status: 'fulfilled', value: true }])
    expect(outputTitle()).toBe('recovered')
    expect(await dispatch('change', 'leaf.ts')).toEqual([])
    expect(await dispatch('change', 'a.ts')).toEqual([])
  })
})
