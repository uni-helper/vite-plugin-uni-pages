import type { FSWatcher } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { build, createServer, normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

interface NativeEvent {
  event: string
  file: string
}

const roots: string[] = []
let close: (() => Promise<unknown>) | undefined

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function page(file: string, title: string): void {
  write(file, `<script setup>definePage({ style: { navigationBarTitleText: ${JSON.stringify(title)} } })</script><template><view /></template>`)
}

function output(root: string): any {
  return parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf8'))
}

/** 哨兵只确认已有订阅，不重写待测页面或补加监听目录 */
async function waitForSubscription(watcher: FSWatcher, directory: string, aliases = [directory]): Promise<void> {
  const basename = `.symlink-watch-ready-${Math.random().toString(36).slice(2)}-`
  const prefixes = aliases.map(alias => normalizePath(path.join(alias, basename)))
  const sentinels: string[] = []
  let observed = false
  const onAll = (_event: string, file: string): void => {
    if (prefixes.some(prefix => normalizePath(file).startsWith(prefix)))
      observed = true
  }
  watcher.on('all', onAll)
  try {
    await vi.waitFor(() => {
      const sentinel = path.join(directory, `${basename}${sentinels.length}`)
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

async function start(root: string, mode: 'serve' | 'build') {
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  write(path.join(root, 'pages.config.json'), '{}')
  write(path.join(root, 'entry.js'), 'export const example = 1')
  const updates = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  const events: NativeEvent[] = []
  let watcher: FSWatcher | undefined
  let scans = 0
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(function (this: PageContext, observed) {
    watcher = observed as unknown as FSWatcher
    watcher.on('all', (event, file) => events.push({ event, file: normalizePath(file) }))
    return setup.call(this, observed)
  })
  const plugin = UniPages({
    dir: 'src/pages',
    subPackages: ['src/alias'],
    outDir: '.',
    dts: false,
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

  const settle = async (): Promise<void> => {
    let snapshot = ''
    let quietSince = Date.now()
    await vi.waitFor(async () => {
      await Promise.allSettled(updates.mock.results.map(result => result.value))
      const current = `${events.length}:${updates.mock.calls.length}`
      if (snapshot !== current) {
        snapshot = current
        quietSince = Date.now()
      }
      expect(Date.now() - quietSince, '原生事件与更新队列应先收敛').toBeGreaterThanOrEqual(250)
    }, { timeout: 10000, interval: 50 })
  }
  await settle()
  return { watcher: watcher!, events, settle }
}

afterEach(async () => {
  await close?.()
  close = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe.each(['serve', 'build'] as const)('%s 符号链接页面监听', (mode) => {
  it('外部目标删除并静默后，单次重建恢复页面及后续修改', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-watch-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const target = path.join(workspace, 'external/pages')
    const alias = path.join(root, 'src/alias')
    const file = path.join(target, 'profile.vue')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(file, 'A')
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const { watcher, events, settle } = await start(root, mode)
    const paths = (relative = '') => [target, alias].map(directory => normalizePath(path.join(directory, relative)))
    const hasEvent = (event: string, relative = '') => events.some(observed => observed.event === event && paths(relative).includes(observed.file))
    const expectTitle = (title: string): void => {
      expect(output(root).subPackages).toMatchObject([{
        root: 'src/alias',
        pages: [{ path: 'profile', style: { navigationBarTitleText: title } }],
      }])
    }
    expectTitle('A')
    await waitForSubscription(watcher, target, [target, alias])
    await settle()

    events.length = 0
    page(file, 'B')
    await vi.waitFor(() => expect(hasEvent('change', 'profile.vue'), '修改应产生目标页面的原生事件').toBe(true), { timeout: 10000 })
    await vi.waitFor(() => expectTitle('B'), { timeout: 10000 })
    await settle()

    events.length = 0
    await fs.promises.rm(target, { recursive: true, maxRetries: 10, retryDelay: 50 })
    await vi.waitFor(() => {
      expect(hasEvent('unlink', 'profile.vue'), '删除应产生目标页面的原生事件').toBe(true)
      expect(hasEvent('unlinkDir'), '删除应产生目标目录的原生事件').toBe(true)
    }, { timeout: 10000 })
    await vi.waitFor(() => expect(output(root).subPackages ?? []).toEqual([]), { timeout: 10000 })
    await settle()

    // 删除阶段完全收敛后只重建一次，避免遗留更新偶然补扫成功
    events.length = 0
    page(file, 'C')
    await vi.waitFor(() => expect(hasEvent('add', 'profile.vue'), '重建应产生目标页面的原生恢复事件').toBe(true), { timeout: 10000 })
    await vi.waitFor(() => expectTitle('C'), { timeout: 10000 })
    await settle()

    events.length = 0
    page(file, 'D')
    await vi.waitFor(() => expect(hasEvent('change', 'profile.vue'), '恢复后修改应继续产生原生事件').toBe(true), { timeout: 10000 })
    await vi.waitFor(() => expectTitle('D'), { timeout: 10000 })
  }, 30000)
})
