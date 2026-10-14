import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src/context'

let root: string
const write = (file: string, content: string): void => fs.writeFileSync(path.join(root, file), content)
const configPath = (file: string): string => normalizePath(path.join(root, file))
const context = (): PageContext => new PageContext({ dts: false }, root, 'h5')
const title = (ctx: PageContext): unknown => ctx.pagesGlobConfig?.globalStyle?.navigationBarTitleText

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-deps-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  write('src/pages/index.vue', '<template><view/></template>')
  write('package.json', '{"type":"module"}')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('配置本地依赖加载', () => {
  it('重新求值直接和间接 TS 依赖，并替换依赖集合', async () => {
    write('pages.config.ts', `import { title } from './direct'; export default { globalStyle: { navigationBarTitleText: title } }`)
    write('direct.ts', `export { title } from './leaf.ts'`)
    write('leaf.ts', `export const title = 'first'`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('first')
    expect(ctx.pagesConfigDependencyPaths).toEqual(expect.arrayContaining(['pages.config.ts', 'direct.ts', 'leaf.ts'].map(configPath)))
    write('leaf.ts', `export const title = 'second'`)
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('second')
    write('next.ts', `export const title = 'next'`)
    write('direct.ts', `export { title } from './next.ts'`)
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('next')
    expect(ctx.pagesConfigDependencyPaths).toContain(configPath('next.ts'))
    expect(ctx.pagesConfigDependencyPaths).not.toContain(configPath('leaf.ts'))
    expect(fs.readdirSync(root).filter(file => file.includes('.bundled_') || file.startsWith('__unconfig_'))).toEqual([])
  })

  it('本地 CJS 依赖可在 TS 配置中调用原生 require', async () => {
    write('pages.config.ts', `import config from './leaf.cjs'; export default { globalStyle: { navigationBarTitleText: config.title } }`)
    write('leaf.cjs', `module.exports = { title: require('node:path').basename('/before') }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('before')
    write('leaf.cjs', `module.exports = { title: require('node:path').basename('/after') }`)
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('after')
  })

  it.each([
    { name: 'TS 枚举', entry: 'index.ts', files: { 'index.ts': `enum Title { Current = 'before' }; export default { title: Title.Current }` }, changed: 'index.ts' },
    { name: '无扩展名的间接 TS 导入', entry: 'index.ts', files: { 'index.ts': `import title from './leaf'; export default { title }`, 'leaf.ts': `export default 'before'` }, changed: 'leaf.ts' },
    { name: 'JSON', entry: 'data.json', files: { 'data.json': '{"title":"before"}' }, changed: 'data.json' },
    { name: '普通 TS', entry: 'index.ts', files: { 'index.ts': `export default { title: 'before' }` }, changed: 'index.ts' },
  ])('workspace 包的 $name 参与加载、监听和重新求值', async ({ entry, files, changed }) => {
    fs.mkdirSync(path.join(root, 'workspace-config'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    write('workspace-config/package.json', JSON.stringify({ name: 'workspace-config', type: 'module', exports: `./${entry}` }))
    fs.symlinkSync(path.join(root, 'workspace-config'), path.join(root, 'node_modules/workspace-config'), 'junction')
    for (const [file, code] of Object.entries(files))
      write(`workspace-config/${file}`, code!)
    write('pages.config.ts', `import config from 'workspace-config'; export default { globalStyle: { navigationBarTitleText: config.title } }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('before')
    expect(ctx.pagesConfigDependencyPaths).toEqual(expect.arrayContaining(Object.keys(files).map(file => configPath(`workspace-config/${file}`))))
    write(`workspace-config/${changed}`, files[changed as keyof typeof files]!.replace('before', 'after'))
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('after')
  })

  it('本地模块按自己的位置和导入方式解析外部包', async () => {
    fs.mkdirSync(path.join(root, 'config/node_modules/local-example'), { recursive: true })
    write('config/node_modules/local-example/package.json', JSON.stringify({
      name: 'local-example',
      type: 'module',
      exports: { import: './import.js', require: './require.cjs' },
    }))
    write('config/node_modules/local-example/import.js', `let count = 0; export default () => 'imported' + ++count`)
    write('config/node_modules/local-example/require.cjs', `let count = 0; module.exports = () => 'required' + ++count`)
    write('config/leaf.cjs', `module.exports = require('local-example')()`)
    write('config/leaf.ts', `import value from 'local-example'; export default value()`)
    write('pages.config.ts', `import cjs from './config/leaf.cjs'; import esm from './config/leaf.ts'; export default { globalStyle: { navigationBarTitleText: cjs + '-' + esm } }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('required1-imported1')
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('required2-imported2')
    expect(ctx.pagesConfigDependencyPaths.some(file => file.includes('/node_modules/'))).toBe(false)
  })

  it('node_modules 中的 TS 包及其相对 JS、TS、JSON 依赖可加载，但不参与监听', async () => {
    fs.mkdirSync(path.join(root, 'node_modules/local-config'), { recursive: true })
    write('node_modules/local-config/package.json', JSON.stringify({
      name: 'local-config',
      type: 'module',
      exports: { import: './index.ts', require: './index.cts' },
    }))
    write('node_modules/local-config/index.ts', `import { title } from './bridge.js'; export default { title: title + '-import' }`)
    write('node_modules/local-config/index.cts', `module.exports = { title: require('./leaf.ts').title + '-require' }`)
    write('node_modules/local-config/bridge.js', `export { title } from './leaf'`)
    write('node_modules/local-config/leaf.ts', `import data from './data.json'; enum Title { Prefix = 'before' }; export const title = Title.Prefix + data.suffix`)
    write('node_modules/local-config/data.json', '{"suffix":"-json"}')
    write('pages.config.ts', `import imported from 'local-config'; const required = require('local-config'); export default { globalStyle: { navigationBarTitleText: imported.title + '/' + required.title } }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('before-json-import/before-json-require')
    expect(ctx.pagesConfigDependencyPaths).toEqual([configPath('pages.config.ts')])
    write('node_modules/local-config/leaf.ts', `throw new Error('package failure'); export const title = 'unused'`)
    await expect(ctx.loadUserPagesConfig()).rejects.toThrow('package failure')
    expect(ctx.pagesConfigDependencyPaths).toEqual([configPath('pages.config.ts')])
    write('node_modules/local-config/leaf.ts', 'export const title =')
    await expect(ctx.loadUserPagesConfig()).rejects.toThrow()
    expect(ctx.pagesConfigDependencyPaths).toEqual([configPath('pages.config.ts')])
  })

  it('node_modules 中的 JSON 包可直接导入，但不参与监听', async () => {
    fs.mkdirSync(path.join(root, 'node_modules/json-config'), { recursive: true })
    write('node_modules/json-config/package.json', '{"name":"json-config","exports":"./data.json"}')
    write('node_modules/json-config/data.json', '{"title":"json-package"}')
    write('pages.config.ts', `import config from 'json-config'; export default { globalStyle: { navigationBarTitleText: config.title } }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('json-package')
    expect(ctx.pagesConfigDependencyPaths).toEqual([configPath('pages.config.ts')])
  })

  it.each(['js', 'mjs', 'cjs', 'json'])('本地 %s 依赖更新后，TS 配置读取新值', async (extension) => {
    const source = (value: string): string => extension === 'json'
      ? JSON.stringify({ title: value })
      : extension === 'cjs' ? `module.exports = { title: '${value}' }` : `export default { title: '${value}' }`
    write(`leaf.${extension}`, source('before'))
    write('pages.config.ts', `import config from './leaf.${extension}'; export default { globalStyle: { navigationBarTitleText: config.title } }`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    write(`leaf.${extension}`, source('after'))
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('after')
    expect(ctx.pagesConfigDependencyPaths).toContain(configPath(`leaf.${extension}`))
  })

  it.each(['js', 'mjs', 'cjs', 'mts', 'cts'])('%s 配置入口本身也重新求值', async (extension) => {
    const source = (value: string): string => extension === 'cjs'
      ? `module.exports = { globalStyle: { navigationBarTitleText: '${value}' } }`
      : `export default { globalStyle: { navigationBarTitleText: '${value}' } }`
    write(`pages.config.${extension}`, source('before'))
    const ctx = context()
    await ctx.loadUserPagesConfig()
    write(`pages.config.${extension}`, source('after'))
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('after')
  })

  it('收集字面量动态导入和 require，忽略纯类型导入', async () => {
    write('pages.config.ts', `import type { Unavailable } from './missing'; const { title } = await import('./dynamic.ts'); const extra = require('./extra.json'); export default { globalStyle: { navigationBarTitleText: title + extra.suffix } }`)
    write('dynamic.ts', `export const title = 'dynamic'`)
    write('extra.json', '{"suffix":"-json"}')
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('dynamic-json')
    expect(ctx.pagesConfigDependencyPaths.map(file => path.basename(file)).sort()).toEqual(['dynamic.ts', 'extra.json', 'pages.config.ts'])
  })

  it('语法错误和已知依赖删除不覆盖上次成功配置，修复后可重新加载', async () => {
    write('pages.config.ts', `import { title } from './leaf.ts'; export default { globalStyle: { navigationBarTitleText: title } }`)
    write('leaf.ts', `export const title = 'before'`)
    const ctx = context()
    await ctx.loadUserPagesConfig()
    const previous = ctx.pagesGlobConfig
    write('leaf.ts', 'export const title =')
    await expect(ctx.loadUserPagesConfig()).rejects.toThrow()
    expect(ctx.pagesGlobConfig).toBe(previous)
    fs.unlinkSync(path.join(root, 'leaf.ts'))
    await expect(ctx.loadUserPagesConfig()).rejects.toThrow()
    expect(ctx.pagesConfigDependencyPaths).toContain(configPath('leaf.ts'))
    write('leaf.ts', `export const title = 'fixed'`)
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('fixed')
  })

  it('新增但尚不存在的相对导入保留恢复候选路径', async () => {
    write('pages.config.ts', 'export default {}')
    const ctx = context()
    await ctx.loadUserPagesConfig()
    write('pages.config.ts', `import { title } from './new-folder/title'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await expect(ctx.loadUserPagesConfig()).rejects.toThrow()
    fs.mkdirSync(path.join(root, 'new-folder'))
    write('new-folder/title.ts', `export const title = 'created'`)
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('created')
  })
})

describe('unconfig 回调兼容性', () => {
  it.each([
    'export const named = 2; export default { value: 1 }',
    'export default { default: { value: 1 }, named: 2 }',
  ])('默认导出对象和命名字段与 unconfig 原加载链一致：%s', async (code) => {
    write('pages.config.ts', code)
    const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
    const { loadConfig } = await import(require.resolve('unconfig'))
    let original: unknown
    await loadConfig({ cwd: root, sources: [{ files: 'pages.config', rewrite: (value: unknown) => {
      original = value
      return {}
    } }] })
    let adapted: unknown
    const ctx = new PageContext({ configSource: { files: 'pages.config', rewrite: (value: unknown) => {
      adapted = value
      return {}
    } }, dts: false }, root, 'h5')
    await ctx.loadUserPagesConfig()
    expect(adapted).toEqual(original)
    expect(Object.keys(adapted as object)).toEqual(Object.keys(original as object))
  })

  it('函数导出只交给 rewrite，不会被加载器主动调用', async () => {
    write('pages.config.ts', `export default () => { throw new Error('must not execute') }`)
    const rewrite = vi.fn((value: unknown) => {
      expect(typeof value).toBe('function')
      return { globalStyle: { navigationBarTitleText: 'rewritten' } }
    })
    const ctx = new PageContext({ configSource: { files: 'pages.config', rewrite }, dts: false }, root, 'h5')
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('rewritten')
    expect(rewrite).toHaveBeenCalledTimes(1)
  })

  it('内置 parser 使用 transform 结果，并按原顺序执行 rewrite', async () => {
    write('pages.config.ts', `export default { globalStyle: { navigationBarTitleText: 'original' } }`)
    const calls: string[] = []
    const ctx = new PageContext({
      configSource: {
        files: 'pages.config',
        transform: (code, filepath) => {
          calls.push('transform')
          expect(normalizePath(filepath)).toBe(configPath('pages.config.ts'))
          return code.replace('original', 'transformed')
        },
        rewrite: (value: any) => {
          calls.push('rewrite')
          expect(value.globalStyle.navigationBarTitleText).toBe('transformed')
          return { globalStyle: { navigationBarTitleText: 'rewritten' } }
        },
      },
      dts: false,
    }, root, 'h5')
    await ctx.loadUserPagesConfig()
    expect(calls).toEqual(['transform', 'rewrite'])
    expect(title(ctx)).toBe('rewritten')
    expect(ctx.pagesConfigDependencyPaths).toEqual([configPath('pages.config.ts')])
    expect(fs.readdirSync(root).some(file => file.startsWith('__unconfig_'))).toBe(false)
  })

  it('显式自定义 parser 仍读取原路径，transform 和 rewrite 各执行一次', async () => {
    write('pages.config.ts', 'original')
    const transform = vi.fn(() => 'transformed')
    const parser = vi.fn((filepath: string) => {
      expect(fs.readFileSync(filepath, 'utf8')).toBe('original')
      return { globalStyle: { navigationBarTitleText: 'custom' } }
    })
    const rewrite = vi.fn((config: any) => config)
    const ctx = new PageContext({ configSource: { files: 'pages.config', transform, parser, rewrite }, dts: false }, root, 'h5')
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('custom')
    expect(transform).toHaveBeenCalledTimes(1)
    expect(parser).toHaveBeenCalledTimes(1)
    expect(rewrite).toHaveBeenCalledTimes(1)
  })

  it('主配置的 JSON 和 auto parser 文本保持原解析语义', async () => {
    write('pages.config.ts', '{"globalStyle":{"navigationBarTitleText":"json"}}')
    const ctx = context()
    await ctx.loadUserPagesConfig()
    expect(title(ctx)).toBe('json')
    expect(ctx.pagesConfigDependencyPaths).toEqual([])
  })
})

describe('上下文更新串行', () => {
  it('配置和多个页面更新排队时保留每个页面的失效信息', async () => {
    const page = (value: string): string => `<script setup>definePage({ style: { navigationBarTitleText: '${value}' } })</script><template><view/></template>`
    write('pages.config.ts', 'export default {}')
    write('src/pages/index.vue', page('index-before'))
    write('src/pages/detail.vue', page('detail-before'))
    const ctx = context()
    await ctx.updatePagesJSON()
    const original = ctx.loadUserPagesConfig.bind(ctx)
    let active = 0
    let maximum = 0
    vi.spyOn(ctx, 'loadUserPagesConfig').mockImplementation(async () => {
      active++
      maximum = Math.max(maximum, active)
      try {
        await original()
      }
      finally {
        active--
      }
    })
    write('src/pages/index.vue', page('index-after'))
    write('src/pages/detail.vue', page('detail-after'))
    await Promise.all([
      ctx.updatePagesJSON(configPath('src/pages/index.vue')),
      ctx.updatePagesJSON(),
      ctx.updatePagesJSON(configPath('src/pages/detail.vue')),
    ])
    expect(maximum).toBe(1)
    expect(ctx.pageMetaData.map(page => page.style?.navigationBarTitleText).sort()).toEqual(['detail-after', 'index-after'])
  })

  it('前一轮失败不会阻断后续更新', async () => {
    write('pages.config.ts', 'export default {}')
    const ctx = context()
    vi.spyOn(ctx, 'loadUserPagesConfig').mockRejectedValueOnce(new Error('temporary failure'))
    const first = ctx.updatePagesJSON()
    const next = ctx.updatePagesJSON()
    await expect(first).rejects.toThrow('temporary failure')
    await expect(next).resolves.toBe(true)
  })
})
