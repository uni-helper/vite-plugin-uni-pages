import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'
import { isConfigLoaderArtifact } from '../packages/core/src/config-loader'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

/**
 * 配置加载的临时产物不能被监听。
 *
 * `bundle-require` 在配置入口旁边写一个 `pages.config.bundled_<id>.mjs`
 * 再立刻删掉，unconfig 写 `__unconfig_*`。这些文件几乎不存在，却会
 * 以两种方式造成伤害：事件被当成配置变更多跑一轮；Windows 上 chokidar
 * 扫描到它、调 `fs.watch` 时文件已经没了，抛出的 EPERM 变成未处理的
 * 拒绝，直接带走进程。所以监听路径、事件过滤、目录遍历三处都要挡掉。
 */

describe('config loader temporary artifacts never reach the watcher', () => {
  let tmpDir: string
  let ctx: PageContext

  const added: string[] = []
  const watcherStub = {
    add: (paths: string[] | string) => {
      added.push(...(Array.isArray(paths) ? paths : [paths]))
    },
    on: vi.fn(),
    off: vi.fn(),
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-artifacts-'))
    fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/index.vue'), '<template><div/></template>', 'utf-8')
    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('recognizes bundled and unconfig artifacts by name', () => {
    expect(isConfigLoaderArtifact('pages.config.bundled_51wkla4irr2.mjs')).toBe(true)
    expect(isConfigLoaderArtifact('__unconfig_pages.config.ts')).toBe(true)
    expect(isConfigLoaderArtifact('pages.config.ts')).toBe(false)
    expect(isConfigLoaderArtifact('leaf.ts')).toBe(false)
  })

  it('does not watch a stale bundled artifact left next to the entry', async () => {
    const artifact = path.join(tmpDir, 'pages.config.bundled_stale.mjs')
    fs.writeFileSync(artifact, 'export default {}', 'utf-8')
    ctx.pagesConfigSourcePaths = [path.join(tmpDir, 'pages.config.ts')]
    // 临时产物混进依赖集合（装载失败的恢复路径就会带上它）
    ctx.pagesConfigDependencyPaths = [path.join(tmpDir, 'leaf.ts'), artifact]

    await ctx.setupWatcher(watcherStub as any)

    expect(added.some(file => file.includes('pages.config.bundled_stale.mjs'))).toBe(false)
    expect(added.some(file => file.includes('leaf.ts'))).toBe(true)
  })

  // 过滤监听列表躲不开目录遍历：chokidar 读到新文件就会去 fs.watch 它，
  // 所以临时产物必须一开始就不写在配置入口旁边。产物写完就删，事后
  // 看目录里没有它并不能说明问题 —— 这里真开一个 watcher 跑一遍装载，
  // 看有没有哪个 watch 落在临时产物上
  it('never asks the OS to watch a config loader temp file', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-bundle-out-')))
    fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view/></template>')
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default { globalStyle: { navigationBarTitleText: 'ok' } }`)

    // watch 目标整个落在 root 上：chokidar 会读目录、逐个文件 fs.watch，
    // 临时产物只要写在 root 里就有机会被它盯上
    const realWatch = fs.watch
    const watched: string[] = []
    const spy = vi.spyOn(fs, 'watch').mockImplementation(((target: any, ...rest: any[]) => {
      watched.push(String(target))
      return (realWatch as any)(target, ...rest)
    }) as typeof fs.watch)

    const server = await createServer({
      root,
      configFile: false,
      plugins: [UniPages({ dts: false })],
      css: { postcss: {} },
      server: { middlewareMode: true, hmr: false },
      logLevel: 'silent',
    })
    try {
      await server.pluginContainer.buildStart({})
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    finally {
      await server.close()
      spy.mockRestore()
    }

    expect(watched.filter(target => target.includes('.bundled_') || target.includes('__unconfig_'))).toEqual([])
    fs.rmSync(root, { recursive: true, force: true })
  })
})
