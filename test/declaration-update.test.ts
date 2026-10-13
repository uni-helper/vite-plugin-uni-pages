import type { ViteDevServer } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages, { PageContext } from '../packages/core/src'

vi.hoisted(() => vi.stubEnv('UNI_PLATFORM', 'h5'))

let root: string
let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (root)
    fs.rmSync(root, { recursive: true, force: true })
})

async function fixture() {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-declaration-update-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view/></template>')
  const config = path.join(root, 'pages.config.ts')
  const dts = path.join(root, 'uni-pages.d.ts')
  const writeConfig = (title: string): void => fs.writeFileSync(config, `export default { pages: [{ path: 'pages/index', style: { navigationBarTitleText: '${title}' } }] }`)
  writeConfig('before')
  vi.stubEnv('UNI_PLATFORM', 'h5')
  vi.stubEnv('VITE_ROOT_DIR', root)
  const onAfterWriteFile = vi.fn()
  const update = vi.spyOn(PageContext.prototype, 'updatePagesJSON')
  let onChange!: (file: string) => unknown
  const setup = PageContext.prototype.setupViteServer
  vi.spyOn(PageContext.prototype, 'setupViteServer').mockImplementation(function (this: PageContext, server) {
    const existing = new Set(server.watcher.listeners('change'))
    setup.call(this, server)
    onChange = server.watcher.listeners('change').find(listener => !existing.has(listener)) as typeof onChange
  })
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [UniPages({ dts, onAfterWriteFile })],
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  const before = await server.ssrLoadModule('virtual:uni-pages')
  expect(before.pages[0].style.navigationBarTitleText).toBe('before')
  const invalidate = vi.spyOn(server.moduleGraph, 'invalidateModule')
  const send = vi.spyOn(server.ws, 'send')
  update.mockClear()
  onAfterWriteFile.mockClear()
  const change = async (title: string): Promise<PromiseSettledResult<boolean>> => {
    writeConfig(title)
    // 直接驱动插件注册的回调，避免把文件系统时序混入声明失败的回归
    const handled = onChange(config)
    const pending = update.mock.results.at(-1)!.value as Promise<boolean>
    const [, result] = await Promise.allSettled([handled, pending])
    return result as PromiseSettledResult<boolean>
  }
  const failDeclaration = (): void => {
    fs.unlinkSync(dts)
    fs.mkdirSync(dts)
  }
  return { dts, onAfterWriteFile, invalidate, send, change, failDeclaration }
}

describe('声明生成失败后的页面更新通知', () => {
  it('页面已提交时仍执行写入回调并使真实 Vite 虚拟模块失效，同内容重试不重复通知', async () => {
    const { dts, onAfterWriteFile, invalidate, send, change, failDeclaration } = await fixture()
    failDeclaration()
    const result = await change('after')
    expect(result).toMatchObject({ status: 'rejected', reason: { code: 'EISDIR' } })
    const output = parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as any
    expect(output.pages[0].style.navigationBarTitleText).toBe('after')
    expect(onAfterWriteFile).toHaveBeenCalledOnce()
    expect(onAfterWriteFile).toHaveBeenCalledWith(path.join(root, 'src/pages.json'), expect.stringContaining('after'))
    expect(invalidate).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'full-reload' })
    const routes = await server!.ssrLoadModule('virtual:uni-pages')
    expect(routes.pages[0].style.navigationBarTitleText).toBe('after')

    fs.rmdirSync(dts)
    expect(await change('after')).toEqual({ status: 'fulfilled', value: false })
    expect(fs.readFileSync(dts, 'utf8')).toContain('/pages/index')
    expect(onAfterWriteFile).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
  })

  it('正常更新只执行一次写入回调和更新通知', async () => {
    const { onAfterWriteFile, invalidate, send, change } = await fixture()
    expect(await change('after')).toEqual({ status: 'fulfilled', value: true })
    expect(onAfterWriteFile).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'full-reload' })
    const routes = await server!.ssrLoadModule('virtual:uni-pages')
    expect(routes.pages[0].style.navigationBarTitleText).toBe('after')
  })

  it('页面内容未变化时，声明失败不产生写入回调或更新通知', async () => {
    const { onAfterWriteFile, invalidate, send, change, failDeclaration } = await fixture()
    failDeclaration()
    expect(await change('before')).toMatchObject({ status: 'rejected', reason: { code: 'EISDIR' } })
    expect(onAfterWriteFile).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
