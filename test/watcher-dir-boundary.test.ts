import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 页面目录前缀判断的边界回归。
 *
 * 旧代码用裸的 startsWith 判断文件是否在页面目录里：配置了
 * 'src/pages' 时，隔壁 'src/pages-sub/…' 的变更事件也被当成页面
 * 变更（Vite 的 watcher 默认盯整个项目，兄弟目录的事件会进来），
 * 白跑一整轮流水线。修复后前缀必须吃到目录边界。
 */

describe('watcher matches page files only inside the configured directories', () => {
  let tmpDir: string
  let ctx: PageContext
  let changeHandler: ((path: string) => void) | undefined

  const watcherStub = {
    add: vi.fn(),
    on: (event: string, handler: (path: string) => void) => {
      if (event === 'change')
        changeHandler = handler
    },
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/index.vue'), '<template><div/></template>', 'utf-8')

    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
    await ctx.setupWatcher(watcherStub as any)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('ignores sibling directories sharing the prefix', () => {
    changeHandler!(path.join(tmpDir, 'src/pages-sub/a.vue'))
    expect(ctx.updatePagesJSON).not.toHaveBeenCalled()
  })

  it('still reacts to files inside the configured directory', () => {
    changeHandler!(path.join(tmpDir, 'src/pages/index.vue'))
    expect(ctx.updatePagesJSON).toHaveBeenCalled()
  })
})
