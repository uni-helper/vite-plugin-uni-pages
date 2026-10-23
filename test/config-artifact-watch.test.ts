import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'
import { isConfigLoaderArtifact } from '../packages/core/src/config-loader'
import { mockPageWatchers } from './helpers/page-watcher'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

describe('config loader temporary artifacts never reach the watcher', () => {
  let tmpDir: string
  let ctx: PageContext

  const added: string[] = []
  const watcherStub = Object.assign(new EventEmitter(), {
    add: (paths: string[] | string) => {
      added.push(...(Array.isArray(paths) ? paths : [paths]))
    },
  })

  beforeEach(async () => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-artifacts-')))
    fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src/pages/index.vue'), '<template><div/></template>', 'utf-8')
    ctx = new PageContext({ dir: 'src/pages', outDir: 'src', dts: false }, tmpDir, 'h5')
    vi.spyOn(ctx, 'updatePagesJSON').mockResolvedValue(false)
  })

  afterEach(async () => {
    await ctx.disposeWatchers()
    vi.restoreAllMocks()
    added.length = 0
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('只识别专用目录内的产物', () => {
    expect(isConfigLoaderArtifact(path.join(tmpDir, 'node_modules/.cache/uni-pages/load/output.mjs'), tmpDir)).toBe(true)
    expect(isConfigLoaderArtifact(path.join(tmpDir, 'node_modules/.cache/uni-pages-other/config.ts'), tmpDir)).toBe(false)
    expect(isConfigLoaderArtifact('settings.bundled_config.ts', tmpDir)).toBe(false)
    expect(isConfigLoaderArtifact('__unconfig_constants.ts', tmpDir)).toBe(false)
  })

  it('专用目录内的产物不进入订阅或触发更新', async () => {
    const artifact = path.join(tmpDir, 'node_modules/.cache/uni-pages/load/output.mjs')
    ctx.pagesConfigSourcePaths = [path.join(tmpDir, 'pages.config.ts')]
    ctx.pagesConfigDependencyPaths = [path.join(tmpDir, 'leaf.ts'), artifact]
    await ctx.setupWatcher(watcherStub as any)
    expect(added).not.toContain(artifact)
    expect(added).toContain(path.join(tmpDir, 'leaf.ts'))
    watcherStub.emit('change', artifact)
    expect(ctx.updatePagesJSON).not.toHaveBeenCalled()
  })

  describe.each(['settings.bundled_config.ts', '__unconfig_constants.ts'])('%s 是真实输入', (filename) => {
    it.each(['入口', '直接依赖', '嵌套依赖'])('%s 修改后仍触发更新', async (position) => {
      const entry = position === '入口' ? filename : 'pages.config.ts'
      const target = position === '嵌套依赖' ? `nested/${filename}` : filename
      fs.mkdirSync(path.join(tmpDir, 'nested'))
      fs.writeFileSync(path.join(tmpDir, target), `export default { globalStyle: { navigationBarTitleText: 'before' } }`)
      if (position === '直接依赖')
        fs.writeFileSync(path.join(tmpDir, entry), `export { default } from './${filename}'`)
      if (position === '嵌套依赖') {
        fs.writeFileSync(path.join(tmpDir, 'nested/module.ts'), `export { default } from './${filename}'`)
        fs.writeFileSync(path.join(tmpDir, entry), `export { default } from './nested/module.ts'`)
      }
      await ctx.disposeWatchers()
      mockPageWatchers()
      ctx = new PageContext({ configSource: { files: entry, extensions: [] }, dts: false }, tmpDir, 'h5')
      await ctx.loadUserPagesConfig()
      expect(ctx.pagesGlobConfig.globalStyle?.navigationBarTitleText).toBe('before')
      const update = vi.spyOn(ctx, 'updatePagesJSON')
      await ctx.setupWatcher(watcherStub as any)
      expect(added).toContain(path.join(tmpDir, target))
      fs.writeFileSync(path.join(tmpDir, target), `export default { globalStyle: { navigationBarTitleText: 'after' } }`)
      watcherStub.emit('change', path.join(tmpDir, target))
      await Promise.all(update.mock.results.map(result => result.value))
      expect(update).toHaveBeenCalledTimes(1)
      expect(ctx.pagesGlobConfig.globalStyle?.navigationBarTitleText).toBe('after')
    })
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
