import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * withUniPlatform 的带点判断回归：旧代码对整条路径做 `/\..*$/`，
 * 目录名带点的页面（如 pages/v1.2/detail）会被当成带平台后缀而
 * 丢弃或截断。修复后只看文件名部分，和 vite-plugin-uni-platform
 * 自己只在文件名上判断后缀的规则一致。
 */

describe('withUniPlatform only treats dots in the file name as platform suffixes', () => {
  let tmpDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-uniplat-dots-'))
    const pagesDir = path.join(tmpDir, 'src', 'pages')
    fs.mkdirSync(path.join(pagesDir, 'v1.2'), { recursive: true })

    const writePage = (file: string, title: string) => {
      fs.writeFileSync(
        path.join(pagesDir, file),
        [
          '<script lang="ts" setup>',
          `definePage(() => ({ style: { navigationBarTitleText: '${title}' } }));`,
          '</script>',
          '',
          `<template><div>${title}</div></template>`,
          '',
        ].join('\n'),
        'utf-8',
      )
    }
    // 目录名带点：不是平台后缀，保留完整路径
    writePage(path.join('v1.2', 'detail.vue'), 'versioned dir')
    // 文件名带别的平台后缀：h5 运行时丢弃
    writePage('index.mp-weixin.vue', 'wx only')
    // 普通页面：保留
    writePage('plain.vue', 'plain')
    // 文件名带当前平台后缀：保留并去掉后缀
    writePage('tabbar.h5.vue', 'h5 tab')

    pagesJsonPath = path.join(tmpDir, 'src', 'pages.json')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps dotted directory paths intact and still applies file-name suffixes', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/plain', dts: false },
      tmpDir,
      'h5',
    )
    ctx.withUniPlatform = true
    await ctx.updatePagesJSON()

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')

    // 目录里的点不算后缀：路径原样保留，不被截成 pages/v1
    expect(content).toContain('"pages/v1.2/detail"')
    expect(content).not.toContain('"pages/v1"')

    // 别的平台的后缀文件在 h5 运行中被丢弃
    expect(content).not.toContain('mp-weixin')
    expect(content).not.toContain('wx only')

    // 普通页面和当前平台后缀的文件保留，后缀被去掉
    expect(content).toContain('"pages/plain"')
    expect(content).toContain('"pages/tabbar"')
    expect(content).not.toContain('"pages/tabbar.h5"')
  })
})
