import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 配置文件变更事件要先归一化、再去和配置源列表比较的回归。
 *
 * watcher 报上来的事件路径和 unconfig 记下的配置源路径可能写法不同
 * 但指向同一个文件（Windows 上斜杠方向不一致、或路径里带冗余的
 * `..` 段），比较前必须归一化，否则对 pages.config.ts 的修改会被
 * 悄悄漏掉，pages.json 不再跟着配置更新。
 */

describe('watcher normalizes config change paths before matching sources', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-config-'))
    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    // sources 的真实来源是 unconfig；这里直接写公共字段，取和
    // 事件路径不同写法、但指向同一个文件的形态
    ctx.pagesConfigSourcePaths = [`${tmpDir}/pages.config.ts`]
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
    await ctx.setupWatcher(watcherStub as any)
  })

  it('reacts to an event path that only differs by a redundant segment', () => {
    // 归一化前两个字符串不相等；归一化后指向同一个配置文件
    changeHandler!(`${tmpDir}/src/../pages.config.ts`)
    expect(ctx.updatePagesJSON).toHaveBeenCalled()
  })

  it('still reacts to an exact source path', () => {
    vi.mocked(ctx.updatePagesJSON).mockClear()
    changeHandler!(`${tmpDir}/pages.config.ts`)
    expect(ctx.updatePagesJSON).toHaveBeenCalled()
  })

  it('still ignores files outside the config sources and page dirs', () => {
    vi.mocked(ctx.updatePagesJSON).mockClear()
    changeHandler!(`${tmpDir}/untracked/notes.txt`)
    expect(ctx.updatePagesJSON).not.toHaveBeenCalled()
  })
})
