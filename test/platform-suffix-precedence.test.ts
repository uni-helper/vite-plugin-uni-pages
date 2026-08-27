import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 平台后缀页面与基础页面并存的优先级契约。
 *
 * vite-plugin-uni-platform 的语义是：`index.h5.vue` 只在 H5 上生效，
 * 覆盖同路径的基础页面 `index.vue`。合并流水线里"剥掉平台后缀 →
 * 按路径去重（保留最后一条）"的组合必须达成这个结果，谁的风格配置
 * 进 pages.json 要锁定下来。
 */
describe('withUniPlatform prefers the suffixed page over the base page', () => {
  let tmpDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-suffix-precedence-'))
    const pagesDir = path.join(tmpDir, 'src', 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

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
    writePage('index.vue', 'base title')
    writePage('index.h5.vue', 'h5 title')

    pagesJsonPath = path.join(tmpDir, 'src', 'pages.json')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes the suffixed page config for the current platform', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/index', dts: false },
      tmpDir,
      'h5',
    )
    ctx.withUniPlatform = true
    await ctx.updatePagesJSON()

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')
    const parsed = cjParse(content) as any

    // 同一路径只留一条，风格来自后缀文件
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0].path).toBe('pages/index')
    expect(parsed.pages[0].style.navigationBarTitleText).toBe('h5 title')
    expect(content).not.toContain('pages/index.h5')
  })
})
