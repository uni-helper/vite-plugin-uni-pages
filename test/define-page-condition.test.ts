import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPages, DefineConditional, evaluateDefinePage, isConditional, resolveConditional } from '../packages/core/src'

/**
 * 从 @uni-ku/pages-json 吸收的 define() 写法的功能测试：函数式
 * definePage 宏拿到 `define`，`define(base).ifdef(...).ifndef(...)`
 * 在扫描时就按当前平台算成普通配置。
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

const DSL = `definePage(({ define }) =>
  define({ style: { navigationBarTitleText: 'base', enablePullDownRefresh: false } })
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    .ifndef(['h5', 'web'], { middlewares: ['auth'] })
);`

describe('conditional definition resolution', () => {
  it('deep-merges matching ifdef branches into the base', () => {
    const cond = new DefineConditional({ style: { a: 1, keep: true } })
      .ifdef('mp-weixin', { style: { b: 2 } })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({
      style: { a: 1, keep: true, b: 2 },
    })
  })

  it('ignores ifdef branches that do not match the platform', () => {
    const cond = new DefineConditional({ style: { a: 1 } })
      .ifdef('mp-weixin', { style: { b: 2 } })

    expect(resolveConditional(cond, 'h5')).toEqual({ style: { a: 1 } })
  })

  it('applies ifndef branches on every platform except the listed ones', () => {
    const cond = new DefineConditional({ style: { a: 1 } })
      .ifndef('h5', { style: { b: 2 } })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({ style: { a: 1, b: 2 } })
    expect(resolveConditional(cond, 'h5')).toEqual({ style: { a: 1 } })
  })

  it('accepts platform arrays for both branch kinds', () => {
    const cond = new DefineConditional({})
      .ifdef(['mp-weixin', 'mp-alipay'], { onMini: true })
      .ifndef(['mp-weixin', 'mp-alipay'], { onOther: true })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({ onMini: true })
    expect(resolveConditional(cond, 'h5')).toEqual({ onOther: true })
  })

  it('treats h5 and web as aliases of the same platform', () => {
    // uni-env 的 isH5/isWeb 同时认 h5 和 web 两个写法；define() 必须
    // 和它一致
    const cond = new DefineConditional({})
      .ifdef('h5', { onBrowser: true })

    expect(resolveConditional(cond, 'web')).toEqual({ onBrowser: true })
    expect(resolveConditional(cond, 'h5')).toEqual({ onBrowser: true })
    expect(resolveConditional(cond, 'mp-weixin')).toEqual({})

    const excluded = new DefineConditional({}).ifndef('web', { notBrowser: true })
    expect(resolveConditional(excluded, 'h5')).toEqual({})
    expect(resolveConditional(excluded, 'mp-weixin')).toEqual({ notBrowser: true })
  })

  it('never matches ifdef with an empty platform list and always matches ifndef', () => {
    const cond = new DefineConditional({})
      .ifdef([], { never: true })
      .ifndef([], { always: true })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({ always: true })
  })

  it('applies matching branches in declaration order, later wins on same keys', () => {
    const cond = new DefineConditional({ title: 'base' })
      .ifndef('h5', { title: 'first' })
      .ifdef('mp-weixin', { title: 'second' })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({ title: 'second' })
  })

  it('merges nested objects recursively but replaces arrays and primitives', () => {
    const cond = new DefineConditional({
      style: { nested: { deep: { a: 1 } }, list: [1, 2], flag: false },
    }).ifdef('mp-weixin', {
      style: { nested: { deep: { b: 2 } }, list: [3], flag: true },
    })

    expect(resolveConditional(cond, 'mp-weixin')).toEqual({
      style: { nested: { deep: { a: 1, b: 2 } }, list: [3], flag: true },
    })
  })

  it('does not mutate the base object', () => {
    const base = { style: { a: 1 } }
    const cond = new DefineConditional(base).ifdef('mp-weixin', { style: { b: 2 } })

    resolveConditional(cond, 'mp-weixin')
    expect(base).toEqual({ style: { a: 1 } })
  })

  it('isConditional only matches conditional definitions', () => {
    expect(isConditional(new DefineConditional({}))).toBe(true)
    expect(isConditional({})).toBe(false)
    expect(isConditional(null)).toBe(false)
    expect(isConditional(undefined)).toBe(false)
  })
})

describe('evaluateDefinePage: conditional DSL', () => {
  it('resolves the DSL for the current platform', async () => {
    const weixin = await evaluateDefinePage(sfc(DSL), virtualFile('dsl.vue'), 'mp-weixin')
    expect(weixin).toEqual({
      type: 'page',
      style: { navigationBarTitleText: 'base', enablePullDownRefresh: false, navigationBarBackgroundColor: '#07c160' },
      middlewares: ['auth'],
    })

    // h5 被 ifndef 分支排除，ifdef 分支也不匹配
    const h5 = await evaluateDefinePage(sfc(DSL), virtualFile('dsl.vue'), 'h5')
    expect(h5).toEqual({
      type: 'page',
      style: { navigationBarTitleText: 'base', enablePullDownRefresh: false },
    })
  })

  it('resolves async function-form macros returning the DSL', async () => {
    const code = sfc('definePage(async ({ define }) => define({ title: \'base\' }).ifdef(\'mp-weixin\', { title: \'weixin\' }));')
    const meta = await evaluateDefinePage(code, virtualFile('dsl-async.vue'), 'mp-weixin')
    expect(meta).toEqual({ type: 'page', title: 'weixin' })
  })

  it('keeps plain object and function macros untouched (regression)', async () => {
    const objectForm = await evaluateDefinePage(sfc('definePage({ style: { navigationBarTitleText: \'obj\' } });'), virtualFile('dsl-obj.vue'), 'mp-weixin')
    expect(objectForm).toEqual({ type: 'page', style: { navigationBarTitleText: 'obj' } })

    const fnForm = await evaluateDefinePage(sfc('definePage(() => ({ style: { navigationBarTitleText: \'fn\' } }));'), virtualFile('dsl-fn.vue'), 'mp-weixin')
    expect(fnForm).toEqual({ type: 'page', style: { navigationBarTitleText: 'fn' } })
  })
})

describe('pipeline: conditional DSL resolves per platform', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-condition-'))
    const pagesDir = path.join(tmpDir, 'src', 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      sfc('definePage({ style: { navigationBarTitleText: \'home\' } });'),
      'utf-8',
    )

    fs.writeFileSync(
      path.join(pagesDir, 'conditional.vue'),
      sfc(DSL),
      'utf-8',
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const findConditional = async (platform: string): Promise<Record<string, any>> => {
    const ctx = await createPages(
      { dir: 'src/pages', homePage: 'pages/index', dts: false },
      { root: tmpDir, platform },
    )
    const routes = JSON.parse(ctx.resolveRoutes())
    return routes.find((p: any) => p.path === 'pages/conditional')
  }

  it('applies both branches on mp-weixin', async () => {
    const page = await findConditional('mp-weixin')
    expect(page).toBeDefined()
    expect(page.style.navigationBarBackgroundColor).toBe('#07c160')
    expect(page.middlewares).toEqual(['auth'])
  })

  it('applies no branch on h5', async () => {
    const page = await findConditional('h5')
    expect(page).toBeDefined()
    expect(page.style.navigationBarBackgroundColor).toBeUndefined()
    expect(page.middlewares).toBeUndefined()
  })

  it('treats web like h5 for branch matching', async () => {
    const page = await findConditional('web')
    expect(page).toBeDefined()
    expect(page.style.navigationBarBackgroundColor).toBeUndefined()
    expect(page.middlewares).toBeUndefined()
  })
})
