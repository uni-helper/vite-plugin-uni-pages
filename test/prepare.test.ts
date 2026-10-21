import type { PrepareOptions } from '../packages/core/src'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'comment-json'
import { createServer, resolveConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'
import { PageSourceWatch } from '../packages/core/src/page-watch'

const coreRequire = createRequire(new URL('../packages/core/package.json', import.meta.url))
const lockfile = coreRequire('proper-lockfile')
const roots: string[] = []

function fixture(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-prepare-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view>首页</view></template>')
  fs.writeFileSync(path.join(root, 'pages.config.ts'), 'export default { globalStyle: { navigationBarTitleText: "配置标题" } }')
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
  return root
}

function readPages(root: string): { pages: { path: string }[], subPackages: { root: string, pages: { path: string }[] }[] } {
  return parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as unknown as ReturnType<typeof readPages>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('pages.prepare()', () => {
  it('首次启动时在下游插件工厂执行前生成完整配置和声明，并由真实 Vite 复用', async () => {
    // 单独验证初始化复用，页面监听的就绪补扫由监听测试覆盖
    vi.spyOn(PageSourceWatch.prototype, 'start').mockImplementation(() => {})
    const root = fixture()
    fs.mkdirSync(path.join(root, 'src/account'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/account/profile.vue'), '<template><view>账户</view></template>')
    const onBeforeLoadUserConfig = vi.fn()
    const pages = UniPages({ subPackages: ['src/account'], onBeforeLoadUserConfig })
    expect(readPages(root).pages).toEqual([{ path: '' }])

    const downstream = vi.fn(() => {
      expect(readPages(root).pages.map(page => page.path)).toEqual(['pages/index'])
      expect(readPages(root).subPackages).toMatchObject([{ root: 'account', pages: [{ path: 'profile' }] }])
      expect(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')).toContain('配置标题')
      expect(fs.readFileSync(path.join(root, 'uni-pages.d.ts'), 'utf8')).toContain('/account/profile')
      return { name: 'reads-pages-in-factory' }
    })
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [await pages.prepare({ platformSuffix: false }), downstream()],
      server: { middlewareMode: true, watch: null },
    })
    try {
      const routes = await server.ssrLoadModule('virtual:uni-pages')
      expect(routes.pages.map((page: { path: string }) => page.path)).toEqual(['pages/index'])
      expect(downstream).toHaveBeenCalledOnce()
      expect(onBeforeLoadUserConfig).toHaveBeenCalledOnce()
      await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
      expect(onBeforeLoadUserConfig).toHaveBeenCalledOnce()
    }
    finally {
      await server.close()
    }
  })

  it('普通同步用法仍先占位，再由 configResolved 完整生成', async () => {
    const root = fixture()
    const pages = UniPages({ dts: false })
    expect(pages).not.toBeInstanceOf(Promise)
    expect(readPages(root).pages).toEqual([{ path: '' }])
    await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'build')
    expect(readPages(root).pages.map(page => page.path)).toEqual(['pages/index'])
    await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
  })

  it('显式 root 不依赖 cwd 中存在 src，也不在推导目录创建文件', async () => {
    const root = fixture()
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-empty-cwd-'))
    roots.push(cwd)
    vi.stubEnv('VITE_ROOT_DIR', undefined)
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const pages = UniPages({ dts: false })
    await expect(pages.prepare({ root, platformSuffix: false })).resolves.toBe(pages)
    expect(readPages(root).pages.map(page => page.path)).toEqual(['pages/index'])
    expect(fs.existsSync(path.join(cwd, 'src'))).toBe(false)
  })

  it('相同参数的并发和重复调用共享一次初始化，并接受等价根目录', async () => {
    const root = fixture()
    const onBeforeLoadUserConfig = vi.fn()
    const pages = UniPages({ dts: false, onBeforeLoadUserConfig })
    const first = pages.prepare({ root, platformSuffix: false })
    const second = pages.prepare({ root: path.join(root, 'src', '..'), platformSuffix: false })
    expect(second).toBe(first)
    await expect(first).resolves.toBe(pages)
    expect(pages.prepare({ platformSuffix: false })).toBe(first)
    expect(onBeforeLoadUserConfig).toHaveBeenCalledOnce()
  })

  it('初始化进行中拒绝冲突参数，且不影响原来的准备任务', async () => {
    const root = fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pages = UniPages({
      dts: false,
      configSource: {
        files: 'pages.config',
        parser: async () => {
          await gate
          return {}
        },
      },
    })
    const pending = pages.prepare({ root, platformSuffix: false })
    try {
      await expect(pages.prepare({ root: path.dirname(root), platformSuffix: false })).rejects.toThrow('root does not match')
      await expect(pages.prepare({ root, platformSuffix: true })).rejects.toThrow('platformSuffix does not match')
      vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
      await expect(pages.prepare({ root, platformSuffix: false })).rejects.toThrow('platform does not match')
    }
    finally {
      release()
      await expect(pending).resolves.toBe(pages)
    }
  })

  it('接管时等待已经开始的准备任务，不重复加载配置', async () => {
    const root = fixture()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loading = new Promise<void>((resolve) => {
      entered = resolve
    })
    const parser = vi.fn(async () => {
      entered()
      await gate
      return {}
    })
    const pages = UniPages({ dts: false, configSource: { files: 'pages.config', parser } })
    const preparing = pages.prepare({ platformSuffix: false })
    let resolved = false
    const resolving = resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve').then(() => {
      resolved = true
    })
    try {
      await loading
      expect(resolved).toBe(false)
    }
    finally {
      release()
      await resolving
      await expect(preparing).resolves.toBe(pages)
    }
    expect(parser).toHaveBeenCalledOnce()
    expect(readPages(root).pages.map(page => page.path)).toEqual(['pages/index'])
  })

  it('接管时校验 Vite root', async () => {
    const root = fixture()
    const pages = await UniPages({ dts: false }).prepare({ platformSuffix: false })
    await expect(resolveConfig({ root: path.dirname(root), configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')).rejects.toThrow('root does not match')
  })

  // prepare() 没参与时，同一个插件实例被 Vite 用另一套参数再配一次
  // （嵌套构建、build() 复用实例、换了 root 或平台）应当照旧重建上下文，
  // 不能变成硬报错
  it('未被 prepare 接管时允许 Vite 换 root 重建', async () => {
    const root = fixture()
    const pages = UniPages({ dts: false })
    await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')
    const second = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-prepare-')))
    roots.push(second)
    fs.mkdirSync(path.join(second, 'src/pages'), { recursive: true })
    vi.stubEnv('VITE_ROOT_DIR', second)
    await expect(resolveConfig({ root: second, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')).resolves.toBeTruthy()
  })

  it('未被 prepare 接管时允许 Vite 换平台重建', async () => {
    const root = fixture()
    const pages = UniPages({ dts: false })
    await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')
    vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
    await expect(resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')).resolves.toBeTruthy()
  })

  // 反向的情形仍要拦住：Vite 先初始化，随后 prepare() 给出一套不同的参数，
  // 说明调用方对当前上下文的理解是错的
  it('vite 接管后 prepare 参数不一致仍然报错', async () => {
    const root = fixture()
    const pages = UniPages({ dts: false })
    await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')
    await expect(pages.prepare({ root, platformSuffix: true })).rejects.toThrow('platformSuffix does not match')
  })

  it.each([false, true])('接管时校验 UniPlatform 状态：prepare=%s', async (platformSuffix) => {
    const root = fixture()
    const pages = await UniPages({ dts: false }).prepare({ platformSuffix })
    const plugins = [pages, ...platformSuffix ? [] : [{ name: 'vite-plugin-uni-platform' }]]
    await expect(resolveConfig({ root, configFile: false, logLevel: 'silent', plugins }, 'serve')).rejects.toThrow('platformSuffix does not match')
  })

  it('从 prepare 调用时读取编译平台，并拒绝接管时的平台变化', async () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<script setup>definePage(({ platform }) => ({ style: { navigationBarTitleText: platform } }))</script>')
    const pages = UniPages({ dts: false })
    vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
    await pages.prepare({ platformSuffix: false })
    expect(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')).toContain('mp-weixin')
    vi.stubEnv('UNI_PLATFORM', 'h5')
    await expect(resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages] }, 'serve')).rejects.toThrow('platform does not match')
  })

  it.each([false, true])('提前生成使用声明的文件名后缀规则：%s', async (platformSuffix) => {
    const root = fixture()
    for (const platform of ['h5', 'mp-weixin'])
      fs.writeFileSync(path.join(root, `src/pages/detail.${platform}.vue`), '<template><view>详情</view></template>')
    const pages = await UniPages({ dts: false }).prepare({ platformSuffix })
    expect(readPages(root).pages.map(page => page.path).sort()).toEqual(platformSuffix
      ? ['pages/detail', 'pages/index']
      : ['pages/detail.h5', 'pages/detail.mp-weixin', 'pages/index'])
    await resolveConfig({ root, configFile: false, logLevel: 'silent', plugins: [pages, ...platformSuffix ? [{ name: 'vite-plugin-uni-platform' }] : []] }, 'serve')
  })

  it('配置加载失败后允许重试，并重新加载配置', async () => {
    const root = fixture()
    const parser = vi.fn().mockRejectedValueOnce(new Error('配置加载失败')).mockResolvedValue({ globalStyle: { navigationBarTitleText: '修复后' } })
    const pages = UniPages({ dts: false, configSource: { files: 'pages.config', parser } })
    await expect(pages.prepare({ platformSuffix: false })).rejects.toThrow('配置加载失败')
    await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
    expect(parser).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')).toContain('修复后')
  })

  it('声明写入失败会拒绝，修复后即使 pages.json 无变化也能重试', async () => {
    const root = fixture()
    const dts = path.join(root, 'uni-pages.d.ts')
    fs.mkdirSync(dts)
    const pages = UniPages({ dts })
    await expect(pages.prepare({ platformSuffix: false })).rejects.toThrow()
    fs.rmdirSync(dts)
    await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
    expect(fs.readFileSync(dts, 'utf8')).toContain('/pages/index')
  })

  it('写锁被占用时拒绝，释放后允许重新生成', async () => {
    const root = fixture()
    const pages = UniPages({ dts: false })
    const release = await lockfile.lock(path.join(root, 'src/pages.json'), { realpath: false })
    try {
      await expect(pages.prepare({ platformSuffix: false })).rejects.toThrow('file lock')
      expect(readPages(root).pages).toEqual([{ path: '' }])
    }
    finally {
      await release()
    }
    await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
    expect(readPages(root).pages.map(page => page.path)).toEqual(['pages/index'])
  })

  it('要求显式声明后缀规则，并在缺失编译环境时给出可重试错误', async () => {
    fixture()
    const pages = UniPages({ dts: false })
    await expect(pages.prepare({} as PrepareOptions)).rejects.toThrow('platformSuffix')
    vi.stubEnv('UNI_PLATFORM', undefined)
    await expect(pages.prepare({ platformSuffix: false })).rejects.toThrow('UNI_PLATFORM')
    vi.stubEnv('UNI_PLATFORM', 'h5')
    await expect(pages.prepare({ platformSuffix: false })).resolves.toBe(pages)
  })
})
