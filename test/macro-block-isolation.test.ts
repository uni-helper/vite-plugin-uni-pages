import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * definePage 宏按 script 块隔离的回归。
 *
 * 一个 SFC 可以同时有 <script setup> 和普通 <script>。旧代码在扫描
 * 阶段遇到其中一个块解析失败（比如还在用 @babel/parser 8 已删除的
 * `assert { ... }` import 属性）就直接放弃整个文件，宏写在另一个块
 * 里也读不出来——页面退回默认配置，而转换阶段照样把宏删掉，配置
 * 悄悄丢失。修复后单个块的解析失败不拦另一个块；两个块都读不出宏
 * 时错误才抛给 Page.read（警告并退回默认配置）。
 */

describe('definePage evaluation survives a broken sibling script block', () => {
  let tmpDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-macro-block-'))
    const pagesDir = path.join(tmpDir, 'src/pages/index')
    fs.mkdirSync(pagesDir, { recursive: true })
    // script setup 里的 assert import 属性解析必败（@babel/parser 8
    // 已删除该语法），definePage 在普通 <script> 里
    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      [
        '<script setup lang="ts">',
        'import item from \'./menu.json\' assert { type: \'json\' }',
        'console.log(item)',
        '</script>',
        '',
        '<script lang="ts">',
        'definePage({ style: { navigationBarTitleText: \'from plain script\' } })',
        '</script>',
        '',
        '<template><div>home</div></template>',
        '',
      ].join('\n'),
      'utf-8',
    )
    pagesJsonPath = path.join(tmpDir, 'src/pages.json')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('still reads the macro from the healthy block', async () => {
    const ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)

    await ctx.updatePagesJSON()

    const parsed = cjParse(fs.readFileSync(pagesJsonPath, 'utf-8')) as any
    expect(parsed.pages[0].style).toEqual({ navigationBarTitleText: 'from plain script' })
    // 坏块的错误不必再让整个页面退回默认配置
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and falls back when no block can provide the macro', async () => {
    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-macro-none-'))
    const pagesDir = path.join(brokenDir, 'src/pages/index')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      [
        '<script setup lang="ts">',
        'import item from \'./menu.json\' assert { type: \'json\' }',
        'console.log(item)',
        '</script>',
        '',
        '<template><div>home</div></template>',
        '',
      ].join('\n'),
      'utf-8',
    )

    const ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, brokenDir, 'h5')
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)

    await ctx.updatePagesJSON()

    // 页面仍然注册，但退回默认配置，且错误可见
    const content = fs.readFileSync(path.join(brokenDir, 'src/pages.json'), 'utf-8')
    expect(content).toContain('pages/index/index')
    expect(content).not.toContain('navigationBarTitleText')
    expect(warn).toHaveBeenCalled()

    fs.rmSync(brokenDir, { recursive: true, force: true })
  })
})
