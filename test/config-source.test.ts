import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PagesConfigLoader } from '../packages/core/src/config-loader'
import { configRuntimeSource, transformConfigSource } from '../packages/core/src/config-source'
import { PageContext } from '../packages/core/src/context'

type ConfigSource = Parameters<PagesConfigLoader['load']>[0][number]

let root: string
function write(file: string, code: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), code)
}
const sourceURL = (file: string): string => pathToFileURL(path.join(root, file)).href
function cacheFiles(): string[] {
  const directory = path.join(root, 'node_modules/.cache/uni-pages')
  return fs.existsSync(directory) ? fs.readdirSync(directory) : []
}
const load = (source: Partial<ConfigSource> = {}) => new PagesConfigLoader(root).load([{ files: 'pages.config.ts', extensions: [], ...source }])

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-source-')))
  write('package.json', '{"type":"module"}')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('配置模块的源位置', () => {
  it('入口和嵌套模块独立解析同名文件及位置变量', async () => {
    const code = `const target = './runtime.cjs'; export default {
      required: require(target), resolved: require.resolve(target), imported: (await import(target)).default,
      url: import.meta.url, filename: import.meta.filename, dirname: import.meta.dirname,
      metaResolved: import.meta.resolve(target), cjsFilename: __filename, cjsDirname: __dirname,
      literalRequire: require('./literal.cjs'), literalImport: (await import('./literal.cjs')).default,
    }`
    write('nested/module.ts', code)
    write('pages.config.ts', `import nested from './nested/module.ts'; ${code.replace('export default', 'const entry =')}; export default { entry, nested }`)
    for (const [directory, value] of [['', 'entry'], ['nested', 'nested']]) {
      write(path.join(directory, 'runtime.cjs'), `module.exports = '${value}'`)
      write(path.join(directory, 'literal.cjs'), `module.exports = '${value}-literal'`)
    }
    const result = await load()
    for (const [directory, name, file] of [['', 'entry', 'pages.config.ts'], ['nested', 'nested', 'nested/module.ts']]) {
      expect((result.config as any)[name]).toEqual({
        required: name,
        resolved: path.join(root, directory, 'runtime.cjs'),
        imported: name,
        url: sourceURL(file),
        filename: path.join(root, file),
        dirname: path.join(root, directory),
        metaResolved: sourceURL(path.join(directory, 'runtime.cjs')),
        cjsFilename: path.join(root, file),
        cjsDirname: path.join(root, directory),
        literalRequire: `${name}-literal`,
        literalImport: `${name}-literal`,
      })
    }
    expect(result.dependencies.map(file => normalizePath(path.relative(root, file))).sort()).toEqual(['literal.cjs', 'nested/literal.cjs', 'nested/module.ts', 'pages.config.ts'])
    expect(cacheFiles()).toEqual([])
  })

  it('计算式包加载和 #imports 按各模块的条件导出解析', async () => {
    for (const [directory, value] of [['', 'entry'], ['nested', 'nested']]) {
      write(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', imports: { '#local': { import: './local.mjs', require: './local.cjs' } } }))
      write(path.join(directory, 'local.mjs'), `export default '${value}-local-import'`)
      write(path.join(directory, 'local.cjs'), `module.exports = '${value}-local-require'`)
      write(path.join(directory, 'node_modules/conditional/package.json'), JSON.stringify({ type: 'module', exports: { import: './import.mjs', require: './require.cjs' } }))
      write(path.join(directory, 'node_modules/conditional/import.mjs'), `export default '${value}-import'`)
      write(path.join(directory, 'node_modules/conditional/require.cjs'), `module.exports = '${value}-require'`)
    }
    const code = `const pkg = 'conditional'; const local = '#local'; export default [require(pkg), (await import(pkg)).default, import.meta.resolve(pkg), require.resolve(pkg), require(local), (await import(local)).default]`
    write('nested/module.ts', code)
    write('pages.config.ts', `import nested from './nested/module.ts'; ${code.replace('export default', 'const entry =')}; export default { entry, nested }`)
    const result = await load()
    for (const [directory, name] of [['', 'entry'], ['nested', 'nested']]) {
      expect((result.config as any)[name]).toEqual([
        `${name}-require`,
        `${name}-import`,
        sourceURL(path.join(directory, 'node_modules/conditional/import.mjs')),
        path.join(root, directory, 'node_modules/conditional/require.cjs'),
        `${name}-local-require`,
        `${name}-local-import`,
      ])
    }
  })

  it('根外 workspace 模块的运行时目标按模块自身位置解析', async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-source-workspace-')))
    try {
      const app = path.join(base, 'app')
      const shared = path.join(base, 'shared')
      fs.mkdirSync(app)
      fs.mkdirSync(shared)
      fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}')
      fs.writeFileSync(path.join(shared, 'package.json'), '{"name":"shared-config","type":"module","exports":"./index.ts"}')
      fs.writeFileSync(path.join(app, 'title.cjs'), `module.exports = 'app'`)
      fs.writeFileSync(path.join(shared, 'title.cjs'), `module.exports = 'shared'`)
      fs.writeFileSync(path.join(shared, 'index.ts'), `const target = './title.cjs'; export default { required: require(target), imported: (await import(target)).default, url: import.meta.url }`)
      fs.mkdirSync(path.join(app, 'node_modules'))
      fs.symlinkSync(shared, path.join(app, 'node_modules/shared-config'), 'junction')
      fs.writeFileSync(path.join(app, 'pages.config.ts'), `import shared from 'shared-config'; export default shared`)

      const result = await new PagesConfigLoader(app).load([{ files: 'pages.config.ts', extensions: [] }])
      expect(result.config).toEqual({
        required: 'shared',
        imported: 'shared',
        url: pathToFileURL(path.join(shared, 'index.ts')).href,
      })
      expect(result.dependencies).toEqual(expect.arrayContaining([
        normalizePath(path.join(shared, 'index.ts')),
        normalizePath(path.join(app, 'pages.config.ts')),
      ]))
      // 运行时目标沿用 Node 缓存，不进入依赖集合
      expect(result.dependencies).not.toContain(normalizePath(path.join(shared, 'title.cjs')))
    }
    finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it.each([
    `const require = (name) => name; export default require('local')`,
    `import require from './local.ts'; export default require('local')`,
    `export default ((require) => require('local'))(value => value)`,
    `export default ({ method(require) { return require('local') } }).method(value => value)`,
    `export default new class { method(require) { return require('local') } }().method(value => value)`,
    `function local() { if (true) { var require = value => value }; return require('local') }; export default local()`,
    `const local = function require(name) { return name === 'once' ? require('local') : name }; export default local('once')`,
    `try { throw value => value } catch (require) { globalThis.__uniPagesShadowValue = require('local') }; export default globalThis.__uniPagesShadowValue; delete globalThis.__uniPagesShadowValue`,
  ])('局部 require 保持自己的调用语义：%s', async (code) => {
    write('local.ts', 'export default value => value')
    write('pages.config.ts', code)
    expect((await load()).config).toBe('local')
  })

  it('字面量和相对路径 glob 仍重新打包，运行时目标沿用 Node 缓存', async () => {
    write('runtime.cjs', `module.exports = 'runtime-before'`)
    write('runtime.mjs', `export default 'esm-before'`)
    write('literal.cjs', `module.exports = 'literal-before'`)
    write('glob/a.cjs', `module.exports = 'glob-before'`)
    write('pages.config.ts', `const cjs = './runtime.cjs'; const esm = './runtime.mjs'; const name = 'a'; export default {
      cjs: require(cjs), esm: (await import(esm)).default, literal: require(\`./literal.cjs\`),
      globRequire: require('./glob/' + name + '.cjs'), globImport: (await import(\`./glob/\${name}.cjs\`)).default,
    }`)
    const first = await load()
    write('runtime.cjs', `module.exports = 'runtime-after'`)
    write('runtime.mjs', `export default 'esm-after'`)
    write('literal.cjs', `module.exports = 'literal-after'`)
    write('glob/a.cjs', `module.exports = 'glob-after'`)
    const second = await load()
    expect(first.config).toEqual({ cjs: 'runtime-before', esm: 'esm-before', literal: 'literal-before', globRequire: 'glob-before', globImport: 'glob-before' })
    expect(second.config).toEqual({ cjs: 'runtime-before', esm: 'esm-before', literal: 'literal-after', globRequire: 'glob-after', globImport: 'glob-after' })
    expect(second.dependencies.map(file => normalizePath(path.relative(root, file))).sort()).toEqual(['glob/a.cjs', 'literal.cjs', 'pages.config.ts'])
  })

  it('计算式 import 保留异步失败、说明符转换及 import options', async () => {
    write('data.json', '{"value":42}')
    write('pages.config.ts', `const target = { toString: () => './data.json' }; const options = { with: { type: 'json' } };
      const missing = 'unavailable-package'; const pending = import(missing); const symbol = import(Symbol('invalid'));
      export default { resolved: import.meta.resolve(target), value: (await import(target, options)).default.value, missing: await pending.then(() => false, () => true), symbol: await symbol.then(() => false, error => error instanceof TypeError) }`)
    expect((await load()).config).toEqual({ resolved: sourceURL('data.json'), value: 42, missing: true, symbol: true })
  })

  it('转换后的错误堆栈仍指向原始 TypeScript 行号', async () => {
    const source = path.join(root, 'pages.config.ts')
    const runtime = path.join(root, 'runtime.mjs')
    const code = `interface Value { title: string }

const value: Value = { title: 'source-error' }

throw new Error(value.title)
export default {}`
    write('pages.config.ts', code)
    write('runtime.mjs', configRuntimeSource({}))
    write('compiled.mjs', (await transformConfigSource(code, source, pathToFileURL(runtime).href)).code)
    const stack = execFileSync(process.execPath, ['--enable-source-maps', '--input-type=module', '-e', `try { await import(${JSON.stringify(sourceURL('compiled.mjs'))}) } catch (error) { console.log(error.stack) }`], { encoding: 'utf8' })
    expect(normalizePath(stack)).toContain(`${normalizePath(source)}:5:`)
  })

  it('计算式缺失目标不扩展自动恢复集合', async () => {
    write('pages.config.ts', `const target = './missing.cjs'; export default require(target)`)
    const loader = new PagesConfigLoader(root)
    await expect(loader.load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toThrow()
    expect([...loader.recoveryPaths]).toEqual([normalizePath(path.join(root, 'pages.config.ts'))])
    expect([...loader.recoveryCandidates]).toEqual([])
    expect([...loader.recoveryDirectories]).toEqual([])
    expect(cacheFiles()).toEqual([])
  })
})

describe('transform 与产物隔离', () => {
  it.each(['pages.config.ts', 'pages.config', 'pages.custom'])('内置 parser 从内存读取 %s 的转换结果', async (file) => {
    const original = `export default { globalStyle: { navigationBarTitleText: 'original' }, filename: __filename }`
    write(file, original)
    write(`__unconfig_${file}`, 'real-neighbor')
    const transform = vi.fn((code: string, filepath: string) => {
      expect(normalizePath(filepath)).toBe(normalizePath(path.join(root, file)))
      return code.replace('original', 'transformed')
    })
    const rewrite = vi.fn((config: any, filepath: string) => {
      expect(normalizePath(filepath)).toBe(normalizePath(path.join(root, file)))
      expect(config.globalStyle.navigationBarTitleText).toBe('transformed')
      expect(config.filename).toBe(path.join(root, file))
      expect(fs.readFileSync(path.join(root, `__unconfig_${file}`), 'utf8')).toBe('real-neighbor')
      expect(fs.readdirSync(root).sort()).toEqual([`__unconfig_${file}`, 'node_modules', 'package.json', file].sort())
      return config
    })
    await load({ files: file, transform, rewrite })
    expect(transform).toHaveBeenCalledTimes(1)
    expect(rewrite).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(original)
    expect(fs.readFileSync(path.join(root, `__unconfig_${file}`), 'utf8')).toBe('real-neighbor')
    expect(cacheFiles()).toEqual([])
  })

  it.each(['json', 'auto'] as const)('%s parser 使用转换后的 JSON，空转换结果沿用原内容', async (parser) => {
    write('pages.config.ts', '{"value":"original"}')
    expect((await load({ parser, transform: code => code.replace('original', 'transformed') })).config).toEqual({ value: 'transformed' })
    expect((await load({ parser, transform: () => '' })).config).toEqual({ value: 'original' })
    expect(cacheFiles()).toEqual([])
  })

  it('import parser 仍能加载 JSON 入口', async () => {
    write('pages.config.json', '{"value":"original"}')
    expect((await load({ files: 'pages.config.json', parser: 'import', transform: code => code.replace('original', 'transformed') })).config).toEqual({ value: 'transformed' })
  })

  it('自定义 parser 读取原入口和原内容，transform → parser → rewrite 各一次', async () => {
    write('pages.config.ts', 'original')
    write('__unconfig_pages.config.ts', 'real-neighbor')
    const calls: string[] = []
    await load({
      transform: (code, file) => {
        calls.push('transform')
        expect(code).toBe('original')
        expect(normalizePath(file)).toBe(normalizePath(path.join(root, 'pages.config.ts')))
        return 'transformed'
      },
      parser: (file) => {
        calls.push('parser')
        expect(normalizePath(file)).toBe(normalizePath(path.join(root, 'pages.config.ts')))
        expect(fs.readFileSync(file, 'utf8')).toBe('original')
        expect(fs.readFileSync(path.join(root, '__unconfig_pages.config.ts'), 'utf8')).toBe('real-neighbor')
        expect(cacheFiles()).toEqual([])
        return {}
      },
      rewrite: () => {
        calls.push('rewrite')
        return {}
      },
    })
    expect(calls).toEqual(['transform', 'parser', 'rewrite'])
  })

  it.each(['transform', 'json', 'compile', 'evaluate', 'parser', 'rewrite'])('%s 失败不遗留产物或改动真实邻接文件', async (stage) => {
    write('pages.config.ts', 'export default {}')
    write('__unconfig_pages.config.ts', 'real-neighbor')
    const fail = (): never => {
      throw new Error('failure')
    }
    const source: Partial<ConfigSource> = {
      transform: stage === 'transform' ? fail : () => stage === 'compile' ? 'export default (' : stage === 'evaluate' ? `throw new Error('failure'); export default {}` : 'export default {}',
      parser: stage === 'parser' ? fail : stage === 'json' ? 'json' : 'import',
      rewrite: stage === 'rewrite' ? fail : undefined,
    }
    await expect(load(source)).rejects.toThrow()
    expect(cacheFiles()).toEqual([])
    expect(fs.readFileSync(path.join(root, '__unconfig_pages.config.ts'), 'utf8')).toBe('real-neighbor')
  })

  it('node_modules 链接到不含 node_modules 的目录时，桥接文件仍保持产物身份', async () => {
    write('store/.keep', '')
    fs.symlinkSync(path.join(root, 'store'), path.join(root, 'node_modules'), 'junction')
    write('runtime.cjs', `module.exports = 'runtime'`)
    write('pages.config.ts', `const target = './runtime.cjs'; export default { value: (await import(target)).default }`)
    const result = await load()
    expect(result.config).toEqual({ value: 'runtime' })
    expect(result.dependencies).toEqual([normalizePath(path.join(root, 'pages.config.ts'))])
    expect(cacheFiles()).toEqual([])
    write('pages.config.ts', `const target = './missing.cjs'; export default await import(target)`)
    const loader = new PagesConfigLoader(root)
    await expect(loader.load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toThrow()
    expect([...loader.recoveryPaths]).toEqual([normalizePath(path.join(root, 'pages.config.ts'))])
    expect([...loader.recoveryCandidates]).toEqual([])
    expect(cacheFiles()).toEqual([])
  })

  it('独立 loader 并行加载同一入口时转换内容和清理互不干扰', async () => {
    write('pages.config.ts', 'export default {}')
    const loads = ['first', 'second'].map(value => load({ transform: () => `await new Promise(resolve => setTimeout(resolve, 20)); export default { value: '${value}' }` }))
    expect((await Promise.all(loads)).map(result => result.config)).toEqual([{ value: 'first' }, { value: 'second' }])
    expect(cacheFiles()).toEqual([])
    expect(fs.readdirSync(root).sort()).toEqual(['node_modules', 'package.json', 'pages.config.ts'])
  })
})

describe('配置模块的 import.meta.env', () => {
  it('入口和依赖共享加载器提供的那一份 env', async () => {
    const env = { MODE: 'staging', VITE_BASE: 'https://example.test' }
    write('src/utils/env.ts', `export const env = import.meta.env; export const base = import.meta.env.VITE_BASE`)
    write('pages.config.ts', `import { env, base } from './src/utils/env.ts'; export default {
      globalStyle: { navigationBarTitleText: base },
      meta: { same: env === import.meta.env, keys: Object.keys(import.meta.env).sort(), mode: import.meta.env.MODE },
    }`)
    const loader = new PagesConfigLoader(root)
    loader.setEnv(env)
    const result = await loader.load([{ files: 'pages.config.ts', extensions: [] }])
    expect(result.config).toEqual({
      globalStyle: { navigationBarTitleText: 'https://example.test' },
      meta: { same: true, keys: ['MODE', 'VITE_BASE'], mode: 'staging' },
    })
  })

  it('setEnv 替换后重新加载读到新值', async () => {
    write('pages.config.ts', `export default { globalStyle: { navigationBarTitleText: import.meta.env.MODE } }`)
    const source = [{ files: 'pages.config.ts', extensions: [] }]
    const loader = new PagesConfigLoader(root)
    loader.setEnv({ MODE: 'first' })
    expect((await loader.load(source)).config.globalStyle?.navigationBarTitleText).toBe('first')
    loader.setEnv({ MODE: 'second' })
    expect((await loader.load(source)).config.globalStyle?.navigationBarTitleText).toBe('second')
  })

  it('没有 Vite 配置时按进程环境兜底，前缀变量和标准键都在', async () => {
    const title = `fallback-${process.pid}`
    vi.stubEnv('VITE_FALLBACK_TITLE', title)
    try {
      write('pages.config.ts', 'export default { globalStyle: { navigationBarTitleText: import.meta.env.VITE_FALLBACK_TITLE + ":" + typeof import.meta.env.DEV + ":" + import.meta.env.BASE_URL } }')
      const result = await new PagesConfigLoader(root).load([{ files: 'pages.config.ts', extensions: [] }])
      expect(result.config.globalStyle?.navigationBarTitleText).toBe(`${title}:boolean:/`)
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('配置模块拿不到的 import.meta 成员', () => {
  it('成员保持 undefined，并按文件位置提示一次', async () => {
    const warn = vi.fn()
    write('src/utils/glob.ts', `export const pages = typeof import.meta.glob === 'function' ? 'available' : 'unavailable'`)
    write('pages.config.ts', `import { pages } from './src/utils/glob.ts'; export default { globalStyle: { navigationBarTitleText: pages } }`)
    const source = [{ files: 'pages.config.ts', extensions: [] }]
    const loader = new PagesConfigLoader(root, warn)
    expect((await loader.load(source)).config.globalStyle?.navigationBarTitleText).toBe('unavailable')
    expect((await loader.load(source)).config.globalStyle?.navigationBarTitleText).toBe('unavailable')
    expect(warn).toHaveBeenCalledOnce()
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('src/utils/glob.ts:1:')
    expect(message).toContain('import.meta.glob')
  })

  it('env 和位置变量不触发提示，依赖里的 import.meta.url 仍指向自己', async () => {
    const warn = vi.fn()
    write('src/utils/meta.ts', `export const info = { url: import.meta.url, env: typeof import.meta.env, hot: typeof import.meta.hot }`)
    write('pages.config.ts', `import { info } from './src/utils/meta.ts'; export default { globalStyle: { navigationBarTitleText: JSON.stringify(info) } }`)
    const result = await new PagesConfigLoader(root, warn).load([{ files: 'pages.config.ts', extensions: [] }])
    expect(JSON.parse(result.config.globalStyle?.navigationBarTitleText as string)).toEqual({ url: sourceURL('src/utils/meta.ts'), env: 'object', hot: 'undefined' })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('src/utils/meta.ts:1:')
    expect(warn.mock.calls[0][0]).toContain('import.meta.hot')
  })
})

describe('配置加载失败的定位说明', () => {
  it('执行阶段的错误补充生成它的入口，编译错误保持原样', async () => {
    write('src/utils/boom.ts', `throw new Error('boom')`)
    write('pages.config.ts', `import './src/utils/boom.ts'; export default {}`)
    const error = await load().then(() => undefined, (error: Error) => error)
    expect(error?.message).toContain('boom')
    expect(error?.message).toContain('The error happened while evaluating the config generated from pages.config.ts')

    write('pages.config.ts', `export default {`)
    const syntax = await load().then(() => undefined, (error: Error) => error)
    expect(syntax?.message).not.toContain('The error happened while evaluating the config')
  })

  it('已经读过 stack 的错误也把说明补进 stack', async () => {
    // 读 stack 之后 Node 会缓存字符串，只改 message 时输出里的 stack 没有说明
    write('pages.config.ts', `const error = new Error('cached'); error.stack; throw error`)
    const error = await load().then(() => undefined, (error: Error) => error)
    expect(error?.message).toContain('The error happened while evaluating the config')
    expect(error?.stack).toContain('The error happened while evaluating the config')
  })

  it('message 只读时保留原错误，不抛 TypeError', async () => {
    write('pages.config.ts', `throw Object.freeze(new Error('frozen'))`)
    const error = await load().then(() => undefined, (error: Error) => error)
    expect(error?.constructor).toBe(Error)
    expect(error?.message).toBe('frozen')
  })

  it('执行阶段抛的 AggregateError 仍按执行失败说明', async () => {
    // AggregateError 也带 errors 数组；按数组判断会把它当成 esbuild 的编译失败
    write('pages.config.ts', `throw new AggregateError([new Error('inner')], 'agg')`)
    const error = await load().then(() => undefined, (error: Error) => error)
    expect(error?.constructor).toBe(AggregateError)
    expect(error?.message).toContain('The error happened while evaluating the config')
  })
})

describe('拿不到的成员提示的出口', () => {
  it('经过 PageContext 的 logger 时由 logger 加前缀，消息里不重复', async () => {
    const warn = vi.fn()
    write('pages.config.ts', `export default { globalStyle: { navigationBarTitleText: String(typeof import.meta.glob) } }`)
    const ctx = new PageContext({ dts: false }, root, 'h5')
    ctx.setLogger({ warn } as unknown as Parameters<PageContext['setLogger']>[0])
    await ctx.loadUserPagesConfig()
    expect(warn).toHaveBeenCalledOnce()
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('pages.config.ts:1:')
    expect(message.startsWith('[vite-plugin-uni-pages]')).toBe(false)
  })

  it('加载失败时同样提示，错误照原样抛出', async () => {
    const warn = vi.fn()
    write('src/utils/boom.ts', `export const pages = typeof import.meta.glob === 'function' ? 'available' : 'unavailable'; throw new Error('boom')`)
    write('pages.config.ts', `import './src/utils/boom.ts'; export default {}`)
    await expect(new PagesConfigLoader(root, warn).load([{ files: 'pages.config.ts', extensions: [] }])).rejects.toThrow('boom')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('src/utils/boom.ts:1:')
  })
})
