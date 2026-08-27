import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPages } from '../packages/core/src'

/**
 * 页面路径里扩展名剥除位置的回归。
 *
 * 旧代码用 `relativePath.replace(extname(...), '')`：字符串替换命中的
 * 是路径里第一次出现的扩展名。目录名里带点时（如
 * `pages/my.vue/index.vue`），第一次出现的是目录名里的那段 `.vue`，
 * 结果目录名被啃掉一块、真正的扩展名反而留在末尾，页面路径变成
 * `pages/my/index.vue`。修复后只从路径末尾剥。
 */

describe('page uri strips the extension only at the end', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-dot-dir-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages/my.vue'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/my.vue/index.vue'), '<template><div/></template>', 'utf-8')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps dotted directory names intact', async () => {
    const ctx = await createPages({ dir: 'src/pages', outDir: 'src' }, { root: tmpDir, platform: 'h5' })
    expect(ctx.pageMetaData.map(page => page.path)).toEqual(['pages/my.vue/index'])
  })
})
