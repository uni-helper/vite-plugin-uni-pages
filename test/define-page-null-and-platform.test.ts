import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPages, evaluateDefinePage } from '../packages/core/src'

/**
 * 从 @uni-ku/pages-json 吸收的 definePage 宏扩展的功能测试：
 *
 * 1. 显式 `null`（对象形式或函数返回值）让页面在当前平台退出
 *    pages.json；宏缺失或函数不返回任何值时页面以默认元信息保留。
 * 2. 函数式宏接收 `{ platform }`，用户无需自己读取
 *    process.env.UNI_PLATFORM 就能按当前平台分支。
 */

function sfc(macro: string): string {
  return [
    '<script lang="ts" setup>',
    macro,
    '</script>',
    '',
    '<template><div>page</div></template>',
    '',
  ].join('\n')
}

// evaluateDefinePage 从文件名推导模块解析，因此即便文件从不在磁盘上
// 存在，也必须传绝对路径
const virtualFile = (name: string): string => path.join(os.tmpdir(), name)

describe('evaluateDefinePage: null opt-out and platform injection', () => {
  it('definePage(null) returns null', async () => {
    const meta = await evaluateDefinePage(sfc('definePage(null);'), virtualFile('null-object.vue'), 'h5')
    expect(meta).toBeNull()
  })

  it('function returning null returns null', async () => {
    const meta = await evaluateDefinePage(sfc('definePage(() => null);'), virtualFile('null-fn.vue'), 'h5')
    expect(meta).toBeNull()
  })

  it('async function returning null returns null', async () => {
    const meta = await evaluateDefinePage(sfc('definePage(async () => null);'), virtualFile('null-async-fn.vue'), 'h5')
    expect(meta).toBeNull()
  })

  it('injects the current platform into function-form macros', async () => {
    const code = sfc('definePage(({ platform }) => ({ style: { navigationBarTitleText: platform } }));')
    const weixin = await evaluateDefinePage(code, virtualFile('platform.vue'), 'mp-weixin')
    expect(weixin?.style?.navigationBarTitleText).toBe('mp-weixin')

    const h5 = await evaluateDefinePage(code, virtualFile('platform.vue'), 'h5')
    expect(h5?.style?.navigationBarTitleText).toBe('h5')
  })

  it('keeps the page when the macro returns nothing', async () => {
    // 回归防护：只有显式 null 才跳过；`undefined` 必须让页面以默认
    // 元信息保留，既有 `definePage(() => {})` 用法不受影响
    const meta = await evaluateDefinePage(sfc('definePage(() => {});'), virtualFile('no-return.vue'), 'h5')
    expect(meta).toEqual({ type: 'page' })
  })

  it('returns undefined when no macro exists', async () => {
    const meta = await evaluateDefinePage(sfc('const a = 1;'), virtualFile('no-macro.vue'), 'h5')
    expect(meta).toBeUndefined()
  })

  it('platform-conditional null only skips the matching platform', async () => {
    const code = sfc('definePage(({ platform }) => platform === \'mp-weixin\' ? null : { style: { navigationBarTitleText: \'kept\' } });')
    expect(await evaluateDefinePage(code, virtualFile('conditional-null.vue'), 'mp-weixin')).toBeNull()

    const h5 = await evaluateDefinePage(code, virtualFile('conditional-null.vue'), 'h5')
    expect(h5?.style?.navigationBarTitleText).toBe('kept')
  })
})

describe('pipeline: definePage(null) drops the page from pages.json', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-null-skip-'))
    const pagesDir = path.join(tmpDir, 'src', 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      sfc('definePage({ style: { navigationBarTitleText: \'home\' } });'),
      'utf-8',
    )

    // 对象形式的退出：每个平台都跳过
    fs.writeFileSync(
      path.join(pagesDir, 'always-skipped.vue'),
      sfc('definePage(null);'),
      'utf-8',
    )

    // 绑定注入平台的函数式退出，外加一个必须随页面一起消失的
    // tabBar 项
    fs.writeFileSync(
      path.join(pagesDir, 'skip-weixin.vue'),
      sfc([
        'definePage(({ platform }) => {',
        '  if (platform === \'mp-weixin\') return null;',
        '  return {',
        '    style: { navigationBarTitleText: \'weixin only hidden\' },',
        '    tabBar: { text: \'Hidden\', index: 1 },',
        '  };',
        '});',
      ].join('\n')),
      'utf-8',
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const paths = (ctx: Awaited<ReturnType<typeof createPages>>): string[] =>
    JSON.parse(ctx.resolveRoutes()).map((p: { path: string }) => p.path)

  it('keeps skipped pages on platforms that do not opt out', async () => {
    const ctx = await createPages(
      { dir: 'src/pages', homePage: 'pages/index', dts: false },
      { root: tmpDir, platform: 'h5' },
    )

    expect(paths(ctx)).toEqual(['pages/index', 'pages/skip-weixin'])

    const tabBar = await ctx.resolveTabBar()
    expect(tabBar?.list?.map(item => item.pagePath)).toContain('pages/skip-weixin')
  })

  it('drops null pages and their tabBar items on the opted-out platform', async () => {
    const ctx = await createPages(
      { dir: 'src/pages', homePage: 'pages/index', dts: false },
      { root: tmpDir, platform: 'mp-weixin' },
    )

    expect(paths(ctx)).toEqual(['pages/index'])

    const tabBar = await ctx.resolveTabBar()
    expect(tabBar?.list?.map(item => item.pagePath) ?? []).not.toContain('pages/skip-weixin')
  })
})
