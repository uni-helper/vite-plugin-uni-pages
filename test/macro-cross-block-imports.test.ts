import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * definePage 跨 script 块引用 import 的回归。
 *
 * Vue SFC 的两个 script 块各有各的 import。旧代码只把"宏所在块"的
 * import 带进沙箱：宏写在 <script setup>、常量 import 在普通
 * <script> 时，求值报"变量未定义"，页面退回默认配置。修复后按
 * "名字被宏引用"从两个块挑 import；没被用到的（比如普通 <script>
 * 里 import 的 .vue 组件，require 加载不动）不进沙箱。
 */

describe('definePage can use imports from both script blocks', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-cross-import-'))
    fs.writeFileSync(path.join(tmpDir, 'title.mjs'), 'export const TITLE = \'跨块导入的标题\'\n', 'utf-8')
    fs.writeFileSync(path.join(tmpDir, 'badge.vue'), '<template><span/></template>', 'utf-8')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads the macro in <script setup> with the import living in plain <script>', async () => {
    const pagesDir = path.join(tmpDir, 'cross')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
      path.join(pagesDir, 'page.vue'),
      [
        '<script lang="ts">',
        // badge 是页面自己的依赖，宏没用它：它不能被带进沙箱求值
        // （require 加载不了 .vue，带上只会让求值失败）
        'import Badge from \'../badge.vue\'',
        'import { TITLE } from \'../title.mjs\'',
        'export default { components: { Badge } }',
        '</script>',
        '',
        '<script setup lang="ts">',
        'definePage({ style: { navigationBarTitleText: TITLE } })',
        '</script>',
        '',
        '<template><Badge/></template>',
        '',
      ].join('\n'),
      'utf-8',
    )

    const ctx = new PageContext({ dir: 'cross', outDir: '.', dts: false, homePage: 'cross/page' }, tmpDir, 'h5')
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)
    await ctx.updatePagesJSON()

    const parsed = cjParse(fs.readFileSync(path.join(tmpDir, 'pages.json'), 'utf-8')) as any
    expect(parsed.pages[0].style).toEqual({ navigationBarTitleText: '跨块导入的标题' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('still picks up imports living next to the macro in the same block', async () => {
    const pagesDir = path.join(tmpDir, 'same-block')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
      path.join(pagesDir, 'page.vue'),
      [
        '<script setup lang="ts">',
        'import { TITLE } from \'../title.mjs\'',
        // 模板字符串里的 `${TITLE}` 是夹具内容，用转义写法避免被
        // no-template-curly-in-string 当成写错的普通字符串
        `definePage(() => ({ style: { navigationBarTitleText: \`\${TITLE}（函数式）\` } }))`,
        '</script>',
        '',
        '<template><div/></template>',
        '',
      ].join('\n'),
      'utf-8',
    )

    const ctx = new PageContext({ dir: 'same-block', outDir: '.', dts: false }, tmpDir, 'h5')
    await ctx.updatePagesJSON()

    const parsed = cjParse(fs.readFileSync(path.join(tmpDir, 'pages.json'), 'utf-8')) as any
    const page = parsed.pages.find((p: any) => p.path === 'same-block/page')
    expect(page.style).toEqual({ navigationBarTitleText: '跨块导入的标题（函数式）' })
  })
})
