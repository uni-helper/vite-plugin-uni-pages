import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'
import { currentPageWatcher, flushPageUpdates, mockPageWatchers } from './helpers/page-watcher'

describe('watcher matches page files only inside the configured directories', () => {
  let tmpDir: string
  let ctx: PageContext
  let watcher: EventEmitter

  beforeAll(async () => {
    mockPageWatchers()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/index.vue'), '<template><div/></template>', 'utf-8')

    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
    const shared = Object.assign(new EventEmitter(), { add: vi.fn() })
    await ctx.setupWatcher(shared as unknown as Parameters<PageContext['setupWatcher']>[0])
    watcher = currentPageWatcher(ctx)!
  })

  afterAll(async () => {
    await ctx.disposeWatchers()
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('ignores sibling directories sharing the prefix', () => {
    watcher.emit('change', path.join(tmpDir, 'src/pages-sub/a.vue'))
    expect(ctx.updatePagesJSON).not.toHaveBeenCalled()
  })

  it('still reacts to files inside the configured directory', async () => {
    watcher.emit('change', path.join(tmpDir, 'src/pages/index.vue'))
    await flushPageUpdates(ctx)
    expect(ctx.updatePagesJSON).toHaveBeenCalled()
  })
})
