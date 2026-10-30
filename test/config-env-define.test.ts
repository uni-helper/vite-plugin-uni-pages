import type { Rollup } from 'vite'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { build, createServer } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'

const roots: string[] = []

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-env-define-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view>首页</view></template>')
  fs.writeFileSync(path.join(root, '.env.staging'), 'VITE_TITLE=from-env-file\n')
  fs.writeFileSync(path.join(root, 'shared.ts'), 'export const title = import.meta.env.VITE_TITLE')
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `import { title } from './shared'; export default { globalStyle: { navigationBarTitleText: title } }`)
  fs.writeFileSync(path.join(root, 'entry.ts'), `export { title } from './shared'`)
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  return root
}

function title(root: string): unknown {
  const pages = parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as { globalStyle?: { navigationBarTitleText?: string } }
  return pages.globalStyle?.navigationBarTitleText
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

async function buildTitle(root: string, define: Record<string, unknown>): Promise<string> {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    mode: 'staging',
    define,
    plugins: [UniPages({ dts: false })],
    build: { write: false, minify: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'], fileName: () => 'entry.mjs' } },
  }) as Rollup.RollupOutput[]
  const entry = result[0].output.find(output => output.type === 'chunk' && output.isEntry) as Rollup.OutputChunk
  const app = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`)
  return app.title
}

it('同一共享模块在应用和配置图中都使用 define 的环境覆盖', async () => {
  const root = fixture()
  const appTitle = await buildTitle(root, { 'import.meta.env.VITE_TITLE': JSON.stringify('from-define') })
  expect(appTitle).toBe('from-define')
  expect(title(root)).toBe(appTitle)
})

it.each([
  { expression: JSON.stringify('static'), expected: 'static' },
  { expression: `import.meta.url.endsWith('/pages.config.ts') ? 'source' : 'bundle'`, expected: 'source' },
  { expression: 'import.meta.env.VITE_TITLE', expected: 'from-env-file' },
])('没有读取的浏览器环境定义不影响配置：$expression', async ({ expression, expected }) => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default { globalStyle: { navigationBarTitleText: ${expression} } }`)
  const appTitle = await buildTitle(root, { 'import.meta.env.BROWSER_ONLY': 'window.RUNTIME_CONFIG' })
  expect(appTitle).toBe('from-env-file')
  expect(title(root)).toBe(expected)
})

it.each(['freeze', 'seal'])('对 env 执行 Object.%s 后仍可读取覆盖值', async (operation) => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'shared.ts'), `const env = Object.${operation}(import.meta.env); export const title = env.VITE_TITLE`)
  const appTitle = await buildTitle(root, { 'import.meta.env.VITE_TITLE': JSON.stringify('readable') })
  expect(appTitle).toBe('readable')
  expect(title(root)).toBe(appTitle)
})

it.each(['build', 'serve'])('%s 保留环境覆盖的值类型、标识符语义和自定义前缀', async (command) => {
  const root = fixture()
  fs.appendFileSync(path.join(root, '.env.staging'), 'APP_VISIBLE=custom-prefix\nSECRET=hidden\n')
  fs.writeFileSync(path.join(root, 'shared.ts'), `
    const env = import.meta.env
    export const title = JSON.stringify({
      title: import.meta.env.VITE_TITLE,
      count: env.COUNT,
      enabled: env.ENABLED,
      options: env.OPTIONS,
      list: env.LIST,
      nullable: env.NULLABLE,
      removed: env.REMOVED === undefined && Object.hasOwn(env, 'REMOVED'),
      expression: import.meta.env.EXPRESSION,
      mode: env.MODE,
      prefix: env.APP_VISIBLE,
      secret: Object.hasOwn(env, 'SECRET'),
      ssr: env.SSR,
    })
  `)
  vi.stubGlobal('__uniPagesEnvDefineValue', 'runtime-value')
  const define = {
    'import.meta.env.VITE_TITLE': JSON.stringify('overridden'),
    'import.meta.env.COUNT': 3,
    'import.meta.env.ENABLED': true,
    'import.meta.env.OPTIONS': { nested: 'value' },
    'import.meta.env.LIST': ['a', 'b'],
    'import.meta.env.NULLABLE': null,
    'import.meta.env.REMOVED': 'undefined',
    'import.meta.env.EXPRESSION': 'globalThis.__uniPagesEnvDefineValue',
    'import.meta.env.MODE': JSON.stringify('defined-mode'),
  }
  const expected = {
    title: 'overridden',
    count: 3,
    enabled: true,
    options: { nested: 'value' },
    list: ['a', 'b'],
    nullable: null,
    removed: true,
    expression: 'runtime-value',
    mode: 'defined-mode',
    prefix: 'custom-prefix',
    secret: false,
    ssr: false,
  }
  if (command === 'build') {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      mode: 'staging',
      envPrefix: ['VITE_', 'APP_'],
      define,
      plugins: [UniPages({ dts: false })],
      build: { write: false, minify: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'], fileName: () => 'entry.mjs' } },
    }) as Rollup.RollupOutput[]
    const entry = result[0].output.find(output => output.type === 'chunk' && output.isEntry) as Rollup.OutputChunk
    const app = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`)
    expect(JSON.parse(app.title)).toEqual(expected)
    expect(title(root)).toBe(app.title)
  }
  else {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      mode: 'staging',
      envPrefix: ['VITE_', 'APP_'],
      define,
      plugins: [UniPages({ dts: false })],
      server: { middlewareMode: true, watch: null, hmr: false },
    })
    try {
      expect(JSON.parse(title(root) as string)).toEqual(expected)
    }
    finally {
      await server.close()
    }
  }
})
