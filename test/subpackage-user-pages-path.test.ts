import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateAll } from '../packages/core/src'

/**
 * pages.config.ts 里子包页面路径的书写惯例回归。
 *
 * pages.json 的 subPackages[].pages[].path 相对 root 书写（root 为
 * 'pkg' 时写 'detail'），pages.config.ts 与 pages.json 一比一对齐。
 * 旧代码把这份用户路径当成"已经相对 root 换算过"的路径又换算了一次，
 * 得到 `../detail`，产物里多出一条指向错误位置的重复条目。修复后
 * 用户路径在合并前先换算到扫描结果的基准，同名页面真正合并成一条，
 * 用户的 style 也照常覆盖扫描结果。
 */

describe('user-config subpackage pages follow the root-relative convention', () => {
  let tmpDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-sub-user-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages/index'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'src/pkg'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/index/index.vue'), '<template><div>home</div></template>', 'utf-8')
    fs.writeFileSync(path.join(tmpDir, 'src/pkg/detail.vue'), '<template><div>detail</div></template>', 'utf-8')
    fs.writeFileSync(
      path.join(tmpDir, 'pages.config.ts'),
      [
        'export default {',
        '  subPackages: [',
        '    {',
        '      root: \'pkg\',',
        '      pages: [',
        '        { path: \'detail\', style: { navigationBarTitleText: \'手写页面\' } },',
        '      ],',
        '    },',
        '  ],',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    )
    pagesJsonPath = path.join(tmpDir, 'src/pages.json')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('merges the user entry into the scanned one instead of mangling its path', async () => {
    await generateAll({
      dir: 'src/pages',
      outDir: 'src',
      subPackages: ['src/pkg'],
      dts: false,
    }, { root: tmpDir, platform: 'h5' })

    const parsed = cjParse(fs.readFileSync(pagesJsonPath, 'utf-8')) as any
    const pkg = parsed.subPackages?.[0]

    expect(pkg.root).toBe('pkg')
    // 同一个页面只剩一条，路径相对 root，用户的 style 生效
    expect(pkg.pages).toHaveLength(1)
    expect(pkg.pages[0].path).toBe('detail')
    expect(pkg.pages[0].style).toEqual({ navigationBarTitleText: '手写页面' })

    // 坏路径（ '../detail' ）不再出现
    expect(fs.readFileSync(pagesJsonPath, 'utf-8')).not.toContain('../detail')
  })
})
