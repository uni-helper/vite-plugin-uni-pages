import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConfigPath, PagesConfigLoader } from '../packages/core/src/config-loader'

const remove = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm: remove }
})

let root: string
const load = (loader: PagesConfigLoader) => loader.load([{ files: 'pages.config.ts', extensions: [] }])
const cacheEntries = (): string[] => fs.readdirSync(path.join(root, 'node_modules/.cache/uni-pages'))

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-cleanup-')))
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default { globalStyle: { navigationBarTitleText: 'loaded' } }`)
  remove.mockReset()
  remove.mockResolvedValue(undefined)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('配置加载目录清理失败', () => {
  it('成功加载不受清理失败影响，残留目录与后续加载互不干扰', async () => {
    remove.mockRejectedValueOnce(new Error('cleanup failed'))
    const loader = new PagesConfigLoader(root)
    await expect(load(loader)).resolves.toMatchObject({
      config: { globalStyle: { navigationBarTitleText: 'loaded' } },
    })
    // 清理失败时目录保留；残留的 load-* 只属于上一轮，不能复用或覆盖
    expect(cacheEntries()).toHaveLength(1)
    await expect(load(loader)).resolves.toMatchObject({
      config: { globalStyle: { navigationBarTitleText: 'loaded' } },
    })
    expect(cacheEntries()).toHaveLength(2)
  })

  it('加载失败保留原始错误，不暴露清理错误', async () => {
    fs.writeFileSync(path.join(root, 'pages.config.ts'), `throw new Error('config failed')\nexport default {}`)
    remove.mockRejectedValueOnce(new Error('cleanup failed'))
    const loader = new PagesConfigLoader(root)
    await expect(load(loader)).rejects.toThrow('config failed')
    expect([...loader.recoveryPaths]).toEqual([normalizeConfigPath(path.join(root, 'pages.config.ts'), root)])
    expect(cacheEntries()).toHaveLength(1)
  })
})
