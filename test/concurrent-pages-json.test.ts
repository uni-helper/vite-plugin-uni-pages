import type { CommentObject } from 'comment-json'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 多终端 pages.json 竞态的回归覆盖。
 *
 * 场景：两个 dev server（如 dev:mp-weixin + dev:h5）写同一个
 * pages.json。H5 终端此前写入过一个 `#ifdef H5` 块。mp-weixin 终端
 * 不得抹掉它——`writePagesJson` 在锁内读取现有文件，保留其他平台的
 * 块。
 *
 * 当前平台通过 PageContext 构造函数注入，不依赖
 * `process.env.UNI_PLATFORM`；H5 终端的输出用预置文件模拟（正是磁盘
 * 上真实竞态的样子）。
 */

describe('concurrent pages.json update preserves other platforms', () => {
  let tmpDir: string
  let srcDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    // 在临时根目录下搭建最小的页面树，让 updatePagesJSON 写进临时
    // 目录而非仓库。
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-concurrent-'))
    srcDir = path.join(tmpDir, 'src')
    const pagesDir = path.join(srcDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    // 一个 definePage 在每个平台都解析出相同元信息的页面。合并因此
    // 只为它保留单个（默认、无注释的）条目。
    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      [
        '<script lang="ts" setup>',
        'definePage(() => ({ style: { navigationBarTitleText: \'home\' } }));',
        '</script>',
        '',
        '<template><div>home</div></template>',
        '',
      ].join('\n'),
      'utf-8',
    )

    pagesJsonPath = path.join(srcDir, 'pages.json')
  })

  beforeEach(() => {
    // 预置只含 H5 条目的文件，就像 H5 终端刚写完一样。
    fs.writeFileSync(
      pagesJsonPath,
      [
        '{',
        '  "pages": [',
        '    // #ifdef H5',
        '    {',
        '      "path": "pages/index",',
        '      "style": {',
        '        "navigationBarTitleText": "home H5"',
        '      }',
        '    }',
        '    // #endif',
        '  ]',
        '}',
      ].join('\n'),
      'utf-8',
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps the seeded #ifdef H5 block while adding the current platform entry', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/index', dts: false },
      tmpDir,
      'mp-weixin',
    )
    await ctx.updatePagesJSON()

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')

    // 「另一个终端」种下的 H5 块必须幸存。
    expect(content).toContain('#ifdef H5')
    expect(content).toContain('#endif')
    expect(content).toContain('home H5')

    // 文件必须仍可按带注释的 JSON 解析（并发读-改-写没有产生半写或
    // 损坏的输出）。cjParse 返回 CommentJSONValue；这里的根总是对象。
    const parsed = cjParse(content) as CommentObject
    const pages = parsed.pages
    expect(Array.isArray(pages)).toBe(true)
    if (!Array.isArray(pages)) {
      return
    }
    const paths = pages
      .filter((p): p is CommentObject => typeof p === 'object' && p !== null)
      .map(p => p.path)
    expect(paths).toContain('pages/index')
  })

  it('serializes overlapping updates without corrupting the file', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/index', dts: false },
      tmpDir,
      'mp-weixin',
    )

    // 近乎同时发起两次更新，模拟两个终端响应同一次文件变更。锁必须
    // 把它们串行化，最终文件有效且仍带有其他平台的块。
    await Promise.all([ctx.updatePagesJSON(), ctx.updatePagesJSON()])

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')
    expect(() => cjParse(content)).not.toThrow()
    expect(content).toContain('#ifdef H5')
  })
})
