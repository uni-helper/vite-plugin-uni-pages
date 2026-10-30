import type { InlineConfig } from 'vite'
import type { UniPagesPlugin } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { build } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'

const roots: string[] = []

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function close(pages: UniPagesPlugin): Promise<void> {
  const hook = pages.closeBundle!
  const handler = typeof hook === 'function' ? hook : hook.handler
  return Promise.resolve(handler.call({} as never))
}

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-env-lifecycle-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view>首页</view></template>')
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default { globalStyle: { navigationBarTitleText: import.meta.env.VITE_TITLE ?? 'prepare' } }`)
  fs.writeFileSync(path.join(root, '.env.staging'), 'VITE_TITLE=staging\n')
  fs.writeFileSync(path.join(root, '.env.production'), 'VITE_TITLE=production\n')
  fs.writeFileSync(path.join(root, 'entry.js'), 'export { pages } from "virtual:uni-pages"')
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  vi.stubEnv('VITE_TITLE', undefined)
  return root
}

function config(root: string, pages: UniPagesPlugin, mode = 'staging'): InlineConfig {
  return {
    root,
    mode,
    configFile: false,
    logLevel: 'silent',
    plugins: [pages],
    build: { write: false, lib: { entry: path.join(root, 'entry.js'), formats: ['es'] } },
  }
}

function title(root: string): unknown {
  const pages = parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as { globalStyle?: { navigationBarTitleText?: string } }
  return pages.globalStyle?.navigationBarTitleText
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

it('prepare 后的真实构建使用 Vite 环境，顺序会话重新读取各自模式', async () => {
  const root = fixture()
  const pages = UniPages({ dts: false })
  await pages.prepare({ root, platformSuffix: false })
  expect(title(root)).toBe('prepare')

  await build(config(root, pages))
  expect(title(root)).toBe('staging')

  await build(config(root, pages, 'production'))
  expect(title(root)).toBe('production')
})

it('prepare 成功后 define 生成失败仍保留参数约束，并允许修正后重试', async () => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `
    const title = import.meta.env.VITE_TITLE ?? 'prepare'
    if (!title)
      throw new Error('页面标题不能为空')
    export default { globalStyle: { navigationBarTitleText: title } }
  `)
  const pages = UniPages({ dts: false })
  await pages.prepare({ root, platformSuffix: false })
  expect(title(root)).toBe('prepare')

  await expect(build({
    ...config(root, pages),
    define: { 'import.meta.env.VITE_TITLE': JSON.stringify('') },
  })).rejects.toThrow('页面标题不能为空')
  await expect(pages.prepare({ root: path.dirname(root), platformSuffix: false })).rejects.toThrow('root does not match')

  await build({
    ...config(root, pages),
    define: { 'import.meta.env.VITE_TITLE': JSON.stringify('retry-with-define') },
  })
  expect(title(root)).toBe('retry-with-define')
})

it('接管时保留进行中 prepare 的原始失败，释放后可以重试', async () => {
  const root = fixture()
  const entered = deferred()
  const resume = deferred()
  const taken = deferred()
  const failure = new Error('准备配置失败')
  let first = true
  const pages = UniPages({
    dts: false,
    configSource: {
      files: 'pages.config.ts',
      extensions: [],
      transform: async (code) => {
        if (first) {
          first = false
          entered.resolve()
          await resume.promise
          throw failure
        }
        return code
      },
    },
  })
  const preparing = pages.prepare({ root, platformSuffix: false }).catch(error => error)
  await entered.promise
  const building = build({
    ...config(root, pages),
    plugins: [pages, { name: 'observe-config-takeover', configResolved: taken.resolve }],
  }).catch(error => error)
  try {
    await taken.promise
  }
  finally {
    resume.resolve()
  }

  expect(await preparing).toBe(failure)
  expect(await building).toBe(failure)
  await build(config(root, pages))
  expect(title(root)).toBe('staging')
})

it('等待进行中的 prepare 完成后，再以 Vite 环境重新生成', async () => {
  const root = fixture()
  const entered = deferred()
  const resume = deferred()
  const taken = deferred()
  const loaded: unknown[] = []
  let first = true
  const pages = UniPages({
    dts: false,
    configSource: {
      files: 'pages.config.ts',
      extensions: [],
      transform: async (code) => {
        if (first) {
          first = false
          entered.resolve()
          await resume.promise
        }
        return code
      },
    },
    onAfterLoadUserConfig(config) {
      loaded.push(config?.globalStyle?.navigationBarTitleText)
    },
  })
  const preparing = pages.prepare({ root, platformSuffix: false })
  await entered.promise
  const building = build({
    ...config(root, pages),
    plugins: [pages, { name: 'observe-config-takeover', configResolved: taken.resolve }],
  })
  try {
    await taken.promise
    expect(loaded).toEqual([])
  }
  finally {
    resume.resolve()
    await Promise.all([preparing, building])
  }

  expect(loaded).toEqual(['prepare', 'staging'])
  expect(title(root)).toBe('staging')
})

it.each([1, 2])('第 %i 轮配置加载期间关闭，会等待当前生成结束并允许新会话', async (blockedRound) => {
  const root = fixture()
  const entered = deferred()
  const resume = deferred()
  const taken = deferred()
  let round = 0
  const pages = UniPages({
    dts: false,
    configSource: {
      files: 'pages.config.ts',
      extensions: [],
      transform: async (code) => {
        if (++round === blockedRound) {
          entered.resolve()
          await resume.promise
        }
        return code
      },
    },
  })
  const preparing = pages.prepare({ root, platformSuffix: false }).catch(error => error)
  if (blockedRound === 1)
    await entered.promise
  else
    await preparing
  const building = build({
    ...config(root, pages),
    plugins: [pages, { name: 'observe-config-takeover', configResolved: taken.resolve }],
  }).catch(error => error)
  await taken.promise
  await entered.promise
  let closed = false
  // Vite 不暴露正在初始化的构建；通过关闭钩子注入这个竞态
  const closing = close(pages).then(() => {
    closed = true
  })
  try {
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(build(config(root, pages))).rejects.toThrow('active Vite session')
  }
  finally {
    resume.resolve()
    await closing
  }

  await preparing
  expect(await building).toHaveProperty('message', expect.stringContaining('closed during initialization'))
  await build(config(root, pages, 'production'))
  expect(title(root)).toBe('production')
})
