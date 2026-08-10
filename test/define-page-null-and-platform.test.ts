import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPages, evaluateDefinePage } from '../packages/core/src'

/**
 * Feature tests for the definePage macro extensions absorbed from
 * @uni-ku/pages-json:
 *
 * 1. An explicit `null` (object form or function return value) opts the page
 *    out of pages.json on the current platform, while a missing macro or a
 *    function returning nothing keeps the page with default metadata.
 * 2. Function-form macros receive `{ platform }` so users can branch on the
 *    current platform without reading process.env.UNI_PLATFORM themselves.
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

// evaluateDefinePage derives module resolution from the filename, so it must
// be an absolute path even though the file never exists on disk
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
    // Regression guard: only an explicit null skips; `undefined` must keep
    // the page with default metadata so existing `definePage(() => {})` usage
    // is unaffected
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

    // Object-form opt-out: skipped on every platform
    fs.writeFileSync(
      path.join(pagesDir, 'always-skipped.vue'),
      sfc('definePage(null);'),
      'utf-8',
    )

    // Function-form opt-out bound to the injected platform, plus a tabBar
    // item that must disappear together with the page
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
