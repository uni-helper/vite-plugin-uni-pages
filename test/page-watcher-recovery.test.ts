import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'
import { flushPageUpdates, mockPageWatchers, pageWatchState } from './helpers/page-watcher'

let root: string
let ctx: PageContext | undefined

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}
function page(title: string): string {
  return `<script setup>definePage({ style: { navigationBarTitleText: '${title}' } })</script><template><view/></template>`
}

beforeEach(() => {
  mockPageWatchers()
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watcher-recovery-')))
  write('package.json', '{"type":"module"}')
  write('src/pages/index.vue', page('index'))
})

afterEach(async () => {
  await ctx?.disposeWatchers()
  ctx = undefined
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('页面监听启动恢复', () => {
  it('启动失败后共享 watcher 的页面事件会重试并恢复更新', async () => {
    const pageRoot = normalizePath(path.join(root, 'src/pages'))
    const read = fs.readdirSync
    vi.spyOn(fs, 'readdirSync').mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (normalizePath(String(file)) === pageRoot)
        throw Object.assign(new Error('I/O error'), { code: 'EIO' })
      return Reflect.apply(read, fs, [file, options])
    }) as typeof fs.readdirSync)

    ctx = new PageContext({ dir: 'src/pages', dts: false }, root, 'h5')
    await ctx.updatePagesJSON()
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
    expect(pageWatchState(ctx).started).toBe(false)

    vi.mocked(fs.readdirSync).mockRestore()
    write('src/pages/detail.vue', page('detail'))
    watcher.emit('change', path.join(root, 'src/pages/detail.vue'))
    await flushPageUpdates(ctx)

    expect(pageWatchState(ctx).started).toBe(true)
    expect(ctx.pageMetaData.map(meta => meta.path).sort()).toEqual(['pages/detail', 'pages/index'])
  })
})
