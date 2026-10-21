import type { FSWatcher } from 'vite'
import type { UserOptions } from '../packages/core/src'
import type { PageSourceWatch } from '../packages/core/src/page-watch'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { build, createServer, normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

const roots: string[] = []
let close: (() => Promise<unknown>) | undefined

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-exclude-watch-')))
  roots.push(root)
  return root
}

function write(root: string, filename: string, content: string): void {
  const file = path.join(root, filename)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function page(root: string, filename: string, title = filename): void {
  write(root, filename, `<script setup>definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} } })</script><template><view /></template>`)
}

function output(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
}

/** 用独立哨兵确认原生订阅可达，随后每个目标文件只修改一次 */
async function waitForSubscription(watcher: FSWatcher, directory: string): Promise<void> {
  const prefix = normalizePath(path.join(directory, '.exclude-watch-ready-'))
  const sentinels: string[] = []
  let observed = false
  const onAll = (_event: string, file: string): void => {
    if (normalizePath(file).startsWith(prefix))
      observed = true
  }
  watcher.on('all', onAll)
  try {
    await vi.waitFor(() => {
      const sentinel = `${prefix}${Math.random().toString(36).slice(2)}`
      sentinels.push(sentinel)
      fs.writeFileSync(sentinel, '')
      expect(observed, `原生监听尚未覆盖 ${directory}`).toBe(true)
    }, { timeout: 10000, interval: 100 })
  }
  finally {
    watcher.off('all', onAll)
    for (const sentinel of sentinels)
      fs.rmSync(sentinel, { force: true })
  }
}

async function start(root: string, mode: 'serve' | 'build', options: UserOptions = {}) {
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  if (!fs.existsSync(path.join(root, 'pages.config.ts')))
    write(root, 'pages.config.json', '{}')
  write(root, 'entry.js', 'export const example = 1')
  const updates = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  const events: string[] = []
  let watcher: FSWatcher | undefined
  let context: { pageWatcher: PageSourceWatch, pendingPageFlush?: Promise<void>, pendingUpdate: Promise<void> }
  let updatePages: (() => Promise<boolean>) | undefined
  let scans = 0
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(function (this: PageContext, observed) {
    context = this as unknown as typeof context
    updatePages = this.updatePagesJSON.bind(this)
    watcher = observed as unknown as FSWatcher
    watcher.on('all', (event, file) => events.push(`${event}:${normalizePath(path.relative(root, file))}`))
    return setup.call(this, observed)
  })
  const plugin = UniPages({
    dir: 'src/pages',
    outDir: '.',
    dts: false,
    ...options,
    onAfterScanPages: () => scans++,
  })
  if (mode === 'serve') {
    const server = await createServer({
      root,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      plugins: [plugin],
      server: { middlewareMode: true },
    })
    close = () => server.close()
  }
  else {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
      build: { watch: {}, outDir: 'dist', lib: { entry: path.join(root, 'entry.js'), formats: ['es'], fileName: () => 'entry.mjs' } },
    })
    if (Array.isArray(result) || !('close' in result))
      throw new Error('Expected a Rollup watcher')
    close = () => result.close()
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'dist/entry.mjs'))).toBe(true), { timeout: 10000 })
  }
  await vi.waitFor(() => expect(scans).toBeGreaterThanOrEqual(2), { timeout: 10000 })
  await waitForSubscription(watcher!, root)
  const settleUpdates = async (): Promise<void> => {
    let pending: Promise<void>
    do {
      await context.pendingPageFlush
      pending = context.pendingUpdate
      await pending
    } while (context.pendingPageFlush || pending !== context.pendingUpdate)
  }
  await settleUpdates()
  const contentWatcher = () => context.pageWatcher.watcher as unknown as FSWatcher
  return { watcher: watcher!, contentWatcher, updatePages: updatePages!, events, settleUpdates, scheduledUpdates: () => updates.mock.calls.length }
}

afterEach(async () => {
  await close?.()
  close = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe.each(['serve', 'build'] as const)('%s 页面排除规则', (mode) => {
  it('按项目根排除页面，收到原生变更事件也不调度生成', async () => {
    const root = fixture()
    page(root, 'src/pages/index.vue')
    page(root, 'src/pages/hidden.vue')
    const { watcher, events, settleUpdates, scheduledUpdates } = await start(root, mode, { exclude: ['src/pages/hidden.vue'] })
    expect(output(root).pages.map((page: any) => page.path)).toEqual(['src/pages/index'])
    await waitForSubscription(watcher, path.join(root, 'src/pages'))
    const before = scheduledUpdates()
    page(root, 'src/pages/hidden.vue', '排除后修改')
    await vi.waitFor(() => expect(events).toContain('change:src/pages/hidden.vue'), { timeout: 10000 })
    await settleUpdates()
    expect(scheduledUpdates()).toBe(before)
    expect(output(root).pages.map((page: any) => page.path)).toEqual(['src/pages/index'])
  }, 30000)

  it('页面排除目录中的合法配置依赖仍可更新生成结果', async () => {
    const root = fixture()
    page(root, 'src/pages/index.vue')
    page(root, 'src/hidden/internal.vue')
    write(root, 'package.json', '{"type":"module"}')
    write(root, 'src/hidden/config.ts', `export const title = '初始配置'`)
    write(root, 'pages.config.ts', `import { title } from './src/hidden/config.ts'; export default { globalStyle: { navigationBarTitleText: title } }`)
    const { watcher, events, scheduledUpdates } = await start(root, mode, { dir: 'src', exclude: ['src/hidden'] })
    expect(output(root).pages.map((page: any) => page.path)).toEqual(['src/pages/index'])
    expect(output(root).globalStyle.navigationBarTitleText).toBe('初始配置')
    await waitForSubscription(watcher, path.join(root, 'src/hidden'))
    const before = scheduledUpdates()
    write(root, 'src/hidden/config.ts', `export const title = '依赖更新'`)
    await vi.waitFor(() => expect(events).toContain('change:src/hidden/config.ts'), { timeout: 10000 })
    await vi.waitFor(() => expect(output(root).globalStyle.navigationBarTitleText).toBe('依赖更新'), { timeout: 10000 })
    expect(scheduledUpdates()).toBeGreaterThan(before)
    expect(output(root).pages.map((page: any) => page.path)).toEqual(['src/pages/index'])
  }, 30000)

  it('启动零匹配后跳过排除目录，并发现新增的有效分包', async () => {
    const root = fixture()
    const { watcher, events, settleUpdates, scheduledUpdates } = await start(root, mode, {
      dir: 'main/*/pages',
      subPackages: [{ dir: 'nested/deep/packages/*/pages', root: dir => path.posix.dirname(dir) }],
      exclude: ['nested/deep/packages/hidden'],
    })
    expect(output(root).pages).toEqual([])
    expect(output(root).subPackages ?? []).toEqual([])
    const before = scheduledUpdates()
    const hiddenPages = path.join(root, 'nested/deep/packages/hidden/pages')
    fs.mkdirSync(hiddenPages, { recursive: true })
    await vi.waitFor(() => expect(events).toContain('addDir:nested/deep/packages/hidden/pages'), { timeout: 10000 })
    await waitForSubscription(watcher, hiddenPages)
    page(root, 'nested/deep/packages/hidden/pages/internal.vue')
    await vi.waitFor(() => expect(events).toContain('add:nested/deep/packages/hidden/pages/internal.vue'), { timeout: 10000 })
    await settleUpdates()
    expect(scheduledUpdates()).toBe(before)
    expect(output(root).subPackages ?? []).toEqual([])

    page(root, 'nested/deep/packages/account/pages/profile.vue', '新增有效页面')
    await vi.waitFor(() => {
      const packages = output(root).subPackages
      expect(packages).toHaveLength(1)
      expect(packages).toMatchObject([{
        root: 'nested/deep/packages/account',
        pages: [{ path: 'pages/profile', style: { navigationBarTitleText: '新增有效页面' } }],
      }])
    }, { timeout: 10000 })
  }, 30000)

  it('运行时改出非法排除规则不会把异常抛给 watcher 回调', async () => {
    const root = fixture()
    page(root, 'src/pages/index.vue')
    // 传入的数组就是解析后的 exclude，运行时改动会触发规则重新编译
    const exclude: string[] = []
    const { watcher, events, settleUpdates, scheduledUpdates } = await start(root, mode, { exclude })
    await waitForSubscription(watcher, path.join(root, 'src/pages'))
    const before = scheduledUpdates()
    exclude.push('!src/pages/index.vue')
    page(root, 'src/pages/index.vue', '非法规则之后')
    await vi.waitFor(() => expect(events).toContain('change:src/pages/index.vue'), { timeout: 10000 })
    await settleUpdates()
    expect(scheduledUpdates()).toBe(before)
    expect(output(root).pages.map((page: any) => page.path)).toEqual(['src/pages/index'])
  }, 30000)

  it('解除外部目录排除并完成补扫后，继续发现新增页面', async () => {
    const workspace = fixture()
    const root = path.join(workspace, 'app')
    const externalPages = path.join(workspace, 'external/account/pages')
    page(root, 'src/pages/index.vue')
    page(workspace, 'external/account/pages/existing.vue')
    const exclude = ['../external']
    const { watcher, contentWatcher, updatePages, settleUpdates } = await start(root, mode, {
      subPackages: ['../external/*/pages'],
      exclude,
    })
    expect(output(root).subPackages ?? []).toEqual([])
    const watchedDirectories = Object.keys(watcher.getWatched()).map(normalizePath)
    expect(watchedDirectories).not.toContain(normalizePath(externalPages))

    exclude.splice(0)
    await updatePages()
    await settleUpdates()
    expect(output(root).subPackages).toMatchObject([{
      root: '../external/account/pages',
      pages: [{ path: 'existing' }],
    }])

    await waitForSubscription(contentWatcher(), externalPages)
    page(workspace, 'external/account/pages/added.vue')
    await vi.waitFor(() => {
      const pages = output(root).subPackages[0].pages.map((page: any) => page.path).sort()
      expect(pages, '外部页面新增后应自动发现').toEqual(['added', 'existing'])
    }, { timeout: 10000 })
  }, 30000)
})
