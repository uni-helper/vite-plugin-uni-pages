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

interface ContextQueue {
  pendingPageFlush: Promise<void> | undefined
  pendingUpdate: Promise<void>
  pendingPageUpdate: unknown
  pageWatcher?: { watcher: FSWatcher }
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
async function waitForSubscription(watchers: readonly FSWatcher[], directory: string, aliases = [directory]): Promise<void> {
  const basename = `.symlink-watch-ready-${Math.random().toString(36).slice(2)}-`
  const prefixes = aliases.map(alias => normalizePath(path.join(alias, basename)))
  const sentinels: string[] = []
  let observed = false
  const onAll = (_event: string, file: string): void => {
    if (prefixes.some(prefix => normalizePath(file).startsWith(prefix)))
      observed = true
  }
  for (const watcher of watchers)
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
    for (const watcher of watchers)
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
  const watchers: FSWatcher[] = []
  const trackWatcher = (watcher: FSWatcher): FSWatcher => {
    if (!watchers.includes(watcher)) {
      watchers.push(watcher)
      watcher.on('all', (event, file) => events.push({ event, file: normalizePath(file) }))
    }
    return watcher
  }
  let queue: ContextQueue
  const subscriptions: { file: string, recursive: boolean, closed: boolean }[] = []
  const watch = fs.watch
  vi.spyOn(fs, 'watch').mockImplementation(((file: fs.PathLike, ...args: any[]) => {
    const subscription = { file: normalizePath(String(file)), recursive: !!args[0]?.recursive, closed: false }
    subscriptions.push(subscription)
    const observed = (watch as any)(file, ...args) as fs.FSWatcher
    observed.on('change', (event, filename) => events.push({ event: `native:${event}`, file: normalizePath(path.join(String(file), String(filename ?? ''))) }))
    observed.once('close', () => subscription.closed = true)
    return observed
  }) as typeof fs.watch)
  let scans = 0
  const setup = PageContext.prototype.setupWatcher
  vi.spyOn(PageContext.prototype, 'setupWatcher').mockImplementation(async function (this: PageContext, observed) {
    queue = this as unknown as ContextQueue
    await setup.call(this, observed)
    trackWatcher(observed as unknown as FSWatcher)
    if (queue.pageWatcher?.watcher)
      trackWatcher(queue.pageWatcher.watcher)
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
  await waitForSubscription(watchers, root)
  const contentWatcher = (): FSWatcher => {
    const watcher = queue!.pageWatcher?.watcher
    expect(watcher, '页面内容应由插件持有的 watcher 监听').toBeDefined()
    return trackWatcher(watcher!)
  }

  const settle = async (): Promise<void> => {
    let snapshot = ''
    let quietSince = Date.now()
    await vi.waitFor(async () => {
      contentWatcher()
      while (true) {
        const update = queue.pendingUpdate
        await queue.pendingPageFlush
        await update
        if (!queue.pendingPageFlush && !queue.pendingPageUpdate && update === queue.pendingUpdate)
          break
      }
      contentWatcher()
      const current = `${events.length}:${updates.mock.calls.length}`
      if (snapshot !== current) {
        snapshot = current
        quietSince = Date.now()
      }
      expect(Date.now() - quietSince, '原生事件与更新队列应先收敛').toBeGreaterThanOrEqual(250)
    }, { timeout: 10000, interval: 50 })
  }
  await settle()
  const expectBoundedScope = (unrelated: string): void => {
    const prefix = normalizePath(unrelated)
    const belongsToUnrelated = (file: string): boolean => file === prefix || file.startsWith(`${prefix}/`)
    expect(subscriptions.filter(entry => belongsToUnrelated(entry.file)), '无关项目不应产生原生监听订阅').toEqual([])
    for (const watcher of watchers)
      expect(Object.keys(watcher.getWatched()).map(normalizePath).filter(belongsToUnrelated), '监听清单不应覆盖无关项目').toEqual([])
  }
  return { watchers, events, settle, subscriptions, expectBoundedScope, contentWatcher, updates }
}

afterEach(async () => {
  await close?.()
  close = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe.each(['serve', 'build'] as const)('%s 符号链接页面监听', (mode) => {
  it('外部目标父目录删除后有界恢复，单次重建恢复页面及后续修改', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-watch-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const external = path.join(workspace, 'external')
    const target = path.join(external, 'pages')
    const unrelated = path.join(workspace, 'other-project')
    const alias = path.join(root, 'src/alias')
    const file = path.join(target, 'profile.vue')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(file, 'A')
    page(path.join(unrelated, 'src/index.vue'), '无关项目')
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const { events, settle, subscriptions, expectBoundedScope, contentWatcher } = await start(root, mode)
    const paths = (relative = '') => [target, alias].map(directory => normalizePath(path.join(directory, relative)))
    const hasEvent = (event: string, relative = '') => events.some(observed => observed.event === event && paths(relative).includes(observed.file))
    const expectTitle = (title: string): void => {
      expect(output(root).subPackages).toMatchObject([{
        root: 'src/alias',
        pages: [{ path: 'profile', style: { navigationBarTitleText: title } }],
      }])
    }
    expectTitle('A')
    await waitForSubscription([contentWatcher()], target, [target, alias])
    await settle()
    expectBoundedScope(unrelated)

    events.length = 0
    page(file, 'B')
    await vi.waitFor(() => expect(hasEvent('change', 'profile.vue'), '修改应产生目标页面的原生事件').toBe(true), { timeout: 10000 })
    await vi.waitFor(() => expectTitle('B'), { timeout: 10000 })
    await settle()

    events.length = 0
    await fs.promises.rm(external, { recursive: true, maxRetries: 10, retryDelay: 50 })
    await vi.waitFor(() => {
      const removedDirectory = hasEvent('unlinkDir') || events.some(event => ['unlinkDir', 'native:rename'].includes(event.event) && [external, target].map(normalizePath).includes(event.file))
      expect(removedDirectory, '删除应产生目标目录或其父目录的原生事件').toBe(true)
    }, { timeout: 10000 })
    await vi.waitFor(() => expect(output(root).subPackages ?? []).toEqual([]), { timeout: 10000 })
    await settle()
    expectBoundedScope(unrelated)
    const recovery = subscriptions.filter(entry => entry.file === normalizePath(workspace) && !entry.closed)
    expect(recovery.length, '恢复观察应覆盖仍存在的目标父级入口').toBeGreaterThan(0)
    expect(recovery.every(entry => !entry.recursive), '恢复入口只能使用非递归监听').toBe(true)

    // 删除阶段完全收敛后只重建一次，避免遗留更新偶然补扫成功
    events.length = 0
    page(file, 'C')
    await vi.waitFor(() => {
      const recovered = hasEvent('add', 'profile.vue') || events.some(event => event.event === 'native:rename' && event.file === normalizePath(external))
      expect(recovered, '单次重建应产生目标页面或恢复入口的原生事件').toBe(true)
    }, { timeout: 10000 })
    await vi.waitFor(() => expectTitle('C'), { timeout: 10000 })
    await settle()
    expectBoundedScope(unrelated)
    await vi.waitFor(() => expect(recovery.every(entry => entry.closed), '目标恢复后应结束临时父级观察').toBe(true))
    await waitForSubscription([contentWatcher()], target, [target, alias])
    await settle()

    events.length = 0
    page(file, 'D')
    await vi.waitFor(() => expect(hasEvent('change', 'profile.vue'), '恢复后修改应继续产生原生事件').toBe(true), { timeout: 10000 })
    await vi.waitFor(() => expectTitle('D'), { timeout: 10000 })
  }, 30000)

  it('来源改指缺失目标后释放旧目标，单次创建新目标后恢复内容监听', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-retarget-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const previous = path.join(workspace, 'previous/pages')
    const target = path.join(workspace, 'replacement/pages')
    const alias = path.join(root, 'src/alias')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(path.join(previous, 'profile.vue'), 'A')
    fs.symlinkSync(previous, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const { contentWatcher, events, settle } = await start(root, mode)
    const previousWatcher = contentWatcher()
    await waitForSubscription([contentWatcher()], previous, [previous, alias])
    await settle()

    fs.unlinkSync(alias)
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await vi.waitFor(() => expect(output(root).subPackages ?? []).toEqual([]), { timeout: 10000 })
    await settle()
    expect(previousWatcher.getWatched(), '改指后应关闭含旧目标的内容 watcher').toEqual({})
    const prefix = normalizePath(previous)
    expect(Object.keys(contentWatcher().getWatched()).map(normalizePath).filter(file => file === prefix || file.startsWith(`${prefix}/`)), '当前内容 watcher 不应包含旧目标').toEqual([])

    events.length = 0
    const file = path.join(target, 'profile.vue')
    page(file, 'B')
    await vi.waitFor(() => {
      expect(events.some(event => event.event === 'native:rename' && event.file === normalizePath(path.dirname(target))), '新目标重建应产生原生入口事件').toBe(true)
      expect(output(root).subPackages).toMatchObject([{
        root: 'src/alias',
        pages: [{ path: 'profile', style: { navigationBarTitleText: 'B' } }],
      }])
    }, { timeout: 10000 })
    await waitForSubscription([contentWatcher()], target, [target, alias])
    await settle()

    events.length = 0
    page(file, 'C')
    await vi.waitFor(() => {
      expect(events.some(event => event.event === 'change' && [file, path.join(alias, 'profile.vue')].map(normalizePath).includes(event.file))).toBe(true)
      expect(output(root).subPackages[0].pages[0].style.navigationBarTitleText).toBe('C')
    }, { timeout: 10000 })
  }, 30000)

  it('页面目录内的嵌套符号链接持续发现页面', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-symlink-nested-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const external = path.join(workspace, 'external-feature')
    const later = path.join(workspace, 'external-later')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(path.join(external, 'a.vue'), 'A')
    page(path.join(later, 'c.vue'), 'C')
    fs.symlinkSync(external, path.join(root, 'src/pages/feature'), process.platform === 'win32' ? 'junction' : 'dir')
    const { settle } = await start(root, mode)
    const paths = (): string[] => output(root).pages.map((entry: any) => entry.path)

    await vi.waitFor(() => expect(paths()).toContain('src/pages/feature/a'), { timeout: 10000 })
    await settle()

    page(path.join(external, 'b.vue'), 'B')
    await vi.waitFor(() => expect(paths()).toContain('src/pages/feature/b'), { timeout: 10000 })

    fs.symlinkSync(later, path.join(root, 'src/pages/later'), process.platform === 'win32' ? 'junction' : 'dir')
    await vi.waitFor(() => expect(paths()).toContain('src/pages/later/c'), { timeout: 10000 })

    page(path.join(later, 'd.vue'), 'D')
    await vi.waitFor(() => expect(paths()).toContain('src/pages/later/d'), { timeout: 10000 })
    await settle()
  }, 30000)

  it('嵌套链接初始目标缺失时，单次创建后恢复页面及后续修改', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-nested-missing-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const target = path.join(workspace, 'external/pages')
    const file = path.join(target, 'profile.vue')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    fs.symlinkSync(target, path.join(root, 'src/pages/feature'), process.platform === 'win32' ? 'junction' : 'dir')
    const { settle } = await start(root, mode)
    const title = () => output(root).pages.find((entry: any) => entry.path === 'src/pages/feature/profile')?.style.navigationBarTitleText

    page(file, '创建')
    await vi.waitFor(() => expect(title()).toBe('创建'), { timeout: 10000 })
    await settle()

    page(file, '修改')
    await vi.waitFor(() => expect(title()).toBe('修改'), { timeout: 10000 })
    await settle()
  }, 30000)

  it('交叉嵌套来源改指后新旧目标分别有效，最后一个旧入口删除后释放订阅', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-nested-cross-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const previous = path.join(workspace, 'previous')
    const target = path.join(workspace, 'replacement')
    const alias = path.join(root, 'src/pages/feature')
    const second = path.join(root, 'src/pages/second')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(path.join(previous, 'profile.vue'), '旧目标')
    page(path.join(target, 'profile.vue'), '新目标')
    for (const source of [alias, second])
      fs.symlinkSync(previous, source, process.platform === 'win32' ? 'junction' : 'dir')
    const { settle, updates, contentWatcher } = await start(root, mode)
    const title = (name: string) => output(root).pages.find((entry: any) => entry.path === `src/pages/${name}/profile`)?.style.navigationBarTitleText

    fs.unlinkSync(alias)
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await vi.waitFor(() => {
      expect(title('feature')).toBe('新目标')
      expect(title('second')).toBe('旧目标')
    }, { timeout: 10000 })
    await settle()

    page(path.join(target, 'profile.vue'), '新目标修改')
    page(path.join(previous, 'profile.vue'), '旧目标修改')
    await vi.waitFor(() => {
      expect(title('feature')).toBe('新目标修改')
      expect(title('second')).toBe('旧目标修改')
    }, { timeout: 10000 })
    await settle()

    fs.unlinkSync(second)
    await vi.waitFor(() => expect(title('second')).toBeUndefined(), { timeout: 10000 })
    await settle()
    const events = vi.fn()
    contentWatcher().on('all', events)
    updates.mockClear()
    page(path.join(previous, 'profile.vue'), '失效来源')
    page(path.join(previous, 'added.vue'), '失效新增')
    await new Promise(resolve => setTimeout(resolve, 300))
    await settle()
    expect(events).not.toHaveBeenCalled()
    expect(updates).not.toHaveBeenCalled()
  }, 30000)

  it('运行中新建多层悬空链接，目标恢复及中间层改指后持续更新', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-nested-chain-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const container = path.join(workspace, 'container')
    const target = path.join(workspace, 'target/pages')
    const replacement = path.join(workspace, 'replacement/pages')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    fs.mkdirSync(container)
    fs.symlinkSync(container, path.join(root, 'src/pages/feature'), process.platform === 'win32' ? 'junction' : 'dir')
    const { settle, contentWatcher } = await start(root, mode)
    const title = () => output(root).pages.find((entry: any) => entry.path === 'src/pages/feature/nested/profile')?.style.navigationBarTitleText
    const nested = path.join(container, 'nested')
    fs.symlinkSync(target, nested, process.platform === 'win32' ? 'junction' : 'dir')
    await settle()

    page(path.join(target, 'profile.vue'), '创建')
    await vi.waitFor(() => expect(title()).toBe('创建'), { timeout: 10000 })
    await settle()

    fs.unlinkSync(nested)
    fs.symlinkSync(replacement, nested, process.platform === 'win32' ? 'junction' : 'dir')
    await vi.waitFor(() => expect(title()).toBeUndefined(), { timeout: 10000 })
    await settle()
    page(path.join(replacement, 'profile.vue'), '改指恢复')
    await vi.waitFor(() => expect(title()).toBe('改指恢复'), { timeout: 10000 })
    await waitForSubscription([contentWatcher()], replacement)
    await settle()
    page(path.join(replacement, 'profile.vue'), '继续修改')
    await vi.waitFor(() => expect(title()).toBe('继续修改'), { timeout: 10000 })
    await settle()
  }, 40000)

  it('多层链接形成循环时订阅保持有界且正常页面继续更新', async () => {
    const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-nested-cycle-')))
    roots.push(workspace)
    const root = path.join(workspace, 'app')
    const first = path.join(workspace, 'first')
    const second = path.join(workspace, 'second')
    page(path.join(root, 'src/pages/index.vue'), '首页')
    page(path.join(first, 'a.vue'), 'A')
    page(path.join(second, 'b.vue'), 'B')
    for (const [target, source] of [
      [first, path.join(root, 'src/pages/feature')],
      [second, path.join(first, 'nested')],
      [first, path.join(second, 'back')],
    ]) {
      fs.symlinkSync(target!, source!, process.platform === 'win32' ? 'junction' : 'dir')
    }
    const { settle, contentWatcher } = await start(root, mode)
    const watched = Object.keys(contentWatcher().getWatched()).map(normalizePath)
    expect(watched).toContain(normalizePath(first))
    expect(watched).toContain(normalizePath(second))
    expect(watched.filter(directory => directory.includes('/back') || directory.includes('/nested'))).toEqual([])
    expect(output(root).pages).toHaveLength(3)

    page(path.join(second, 'b.vue'), 'B 修改')
    await vi.waitFor(() => expect(output(root).pages.find((entry: any) => entry.path === 'src/pages/feature/nested/b')?.style.navigationBarTitleText).toBe('B 修改'), { timeout: 10000 })
    await settle()
  }, 20000)
})
