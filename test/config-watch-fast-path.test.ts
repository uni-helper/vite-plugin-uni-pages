import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import fs, { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src/context'
import { PageSourceWatch } from '../packages/core/src/page-watch'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

let root: string
let ctx: PageContext | undefined
let updates: MockInstance<PageContext['updatePagesJSON']>
let realpath: MockInstance<typeof fs.realpathSync.native>
interface OutputConfig {
  globalStyle?: { navigationBarTitleText: string }
}
const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
const write = (file: string, content: string): void => fs.writeFileSync(path.join(root, file), content)
const output = (): OutputConfig => parse<OutputConfig>(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8'))

function config(filename: string, title: string): string {
  const value = JSON.stringify({ globalStyle: { navigationBarTitleText: title } })
  return filename.endsWith('.ts') ? `export default ${value}` : value
}

async function start(filename = 'pages.config.ts'): Promise<void> {
  fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true })
  write(filename, config(filename, 'initial'))
  ctx = new PageContext({
    dts: true,
    configSource: {
      files: filename,
      extensions: [],
      ...filename.endsWith('.custom') ? { parser: (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) } : {},
    },
  }, root, 'h5')
  await ctx.updatePagesJSON()
  updates = vi.spyOn(ctx, 'updatePagesJSON')
  await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
  // 预热既有目录缓存，避免将一次性初始化计入每次事件的开销
  watcher.emit('change', path.join(root, 'package.json'))
}

async function dispatch(event: 'add' | 'change' | 'unlink', file: string): Promise<{ exists: number, realpath: number }> {
  updates.mockClear()
  vi.mocked(existsSync).mockClear()
  realpath.mockClear()
  watcher.emit(event, `${root}/${file}`)
  // 只统计同步事件匹配，重新加载配置时的文件读取不计入此处
  const calls = { exists: vi.mocked(existsSync).mock.calls.length, realpath: realpath.mock.calls.length }
  await Promise.allSettled(updates.mock.results.map(result => result.value))
  return calls
}

beforeEach(() => {
  vi.spyOn(PageSourceWatch.prototype, 'start').mockImplementation(() => {})
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-fast-path-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  write('package.json', '{"type":"module"}')
  write('src/pages/index.vue', '<template><view/></template>')
  realpath = vi.spyOn(fs.realpathSync, 'native')
})

afterEach(async () => {
  await ctx?.disposeWatchers()
  ctx = undefined
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('配置 watcher 路径匹配开销', () => {
  it('关闭页面合并时，配置监听就绪仍补读首次加载后的变化', async () => {
    write('pages.config.json', config('pages.config.json', 'initial'))
    ctx = new PageContext({ mergePages: false, dts: false }, root, 'h5')
    await ctx.updatePagesJSON()
    await ctx.setupWatcher(watcher as unknown as Parameters<PageContext['setupWatcher']>[0])
    updates = vi.spyOn(ctx, 'updatePagesJSON')
    write('pages.config.json', config('pages.config.json', 'updated'))

    watcher.emit('ready')
    await Promise.allSettled(updates.mock.results.map(result => result.value))

    expect(updates).toHaveBeenCalledOnce()
    expect(output().globalStyle?.navigationBarTitleText).toBe('updated')
  })

  it.each(['pages.config', 'pages.custom', 'pages.config.ts', 'pages.config.json'])('已知入口 %s 的事件匹配不查询文件系统', async (filename) => {
    await start(filename)
    write(filename, config(filename, 'updated'))

    expect(await dispatch('change', `src/../${filename}`)).toEqual({ exists: 0, realpath: 0 })
    expect(updates).toHaveBeenCalledOnce()
    expect(output().globalStyle?.navigationBarTitleText).toBe('updated')
  })

  it.each(['src/pages.json', 'uni-pages.d.ts'])('生成文件 %s 的事件无需解析路径或重载配置', async (filename) => {
    await start()

    expect(await dispatch('change', filename)).toEqual({ exists: 0, realpath: 0 })
    expect(updates).not.toHaveBeenCalled()
    expect(output().globalStyle?.navigationBarTitleText).toBe('initial')
  })

  it('已知依赖变更直接命中，切换依赖后旧文件不再触发重载', async () => {
    await start()
    write('leaf.ts', `export const title = 'dependency-initial'`)
    write('pages.config.ts', `import { title } from './leaf.ts'; export default { globalStyle: { navigationBarTitleText: title } }`)
    await dispatch('change', 'pages.config.ts')
    expect(output().globalStyle?.navigationBarTitleText).toBe('dependency-initial')

    write('leaf.ts', `export const title = 'dependency-updated'`)
    expect(await dispatch('change', 'leaf.ts')).toEqual({ exists: 0, realpath: 0 })
    expect(output().globalStyle?.navigationBarTitleText).toBe('dependency-updated')

    write('pages.config.ts', config('pages.config.ts', 'standalone'))
    await dispatch('change', 'pages.config.ts')
    await dispatch('change', 'leaf.ts')
    expect(updates).not.toHaveBeenCalled()
    expect(output().globalStyle?.navigationBarTitleText).toBe('standalone')
  })

  it.each(['file', 'directory'] as const)('%s 符号链接事件未直接命中时仍按真实路径更新配置', async (kind) => {
    const filename = 'config/pages.config.ts'
    await start(filename)
    const alias = kind === 'file' ? 'alias.custom' : 'linked/pages.config.ts'
    if (kind === 'file')
      fs.symlinkSync(path.join(root, filename), path.join(root, alias), 'file')
    else
      fs.symlinkSync(path.join(root, 'config'), path.join(root, 'linked'), 'junction')
    write(alias, config(filename, 'alias-updated'))

    const calls = await dispatch('change', alias)
    expect(calls.realpath).toBeGreaterThan(0)
    expect(updates).toHaveBeenCalledOnce()
    expect(output().globalStyle?.navigationBarTitleText).toBe('alias-updated')
  })

  it('生成文件的符号链接别名仍被排除', async () => {
    await start()
    fs.symlinkSync(path.join(root, 'src/pages.json'), path.join(root, 'output.custom'), 'file')

    const calls = await dispatch('change', 'output.custom')
    expect(calls.realpath).toBeGreaterThan(0)
    expect(updates).not.toHaveBeenCalled()
  })

  it('已知入口替换为符号链接后重载并刷新路径索引', async () => {
    await start()
    write('replacement.ts', config('replacement.ts', 'replacement'))
    fs.unlinkSync(path.join(root, 'pages.config.ts'))
    fs.symlinkSync(path.join(root, 'replacement.ts'), path.join(root, 'pages.config.ts'), 'file')

    expect(await dispatch('change', 'pages.config.ts')).toEqual({ exists: 0, realpath: 0 })
    expect(output().globalStyle?.navigationBarTitleText).toBe('replacement')

    write('replacement.ts', config('replacement.ts', 'target-updated'))
    expect(await dispatch('change', 'replacement.ts')).toEqual({ exists: 0, realpath: 0 })
    expect(output().globalStyle?.navigationBarTitleText).toBe('target-updated')

    write('pages.config.ts', config('pages.config.ts', 'alias-updated'))
    expect((await dispatch('change', 'pages.config.ts')).realpath).toBeGreaterThan(0)
    expect(output().globalStyle?.navigationBarTitleText).toBe('alias-updated')
  })

  it('已知入口删除和重建均能直接命中并更新产物', async () => {
    await start()
    fs.unlinkSync(path.join(root, 'pages.config.ts'))
    expect(await dispatch('unlink', 'pages.config.ts')).toEqual({ exists: 0, realpath: 0 })
    expect(output().globalStyle).toBeUndefined()

    write('pages.config.ts', config('pages.config.ts', 'recreated'))
    expect(await dispatch('add', 'pages.config.ts')).toEqual({ exists: 0, realpath: 0 })
    expect(output().globalStyle?.navigationBarTitleText).toBe('recreated')
  })
})
