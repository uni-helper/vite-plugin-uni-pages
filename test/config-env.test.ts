import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { resolveConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UniPages from '../packages/core/src'

let root: string

/** 一个最小 uni-app 工程：首页 + 从配置里读 import.meta.env 的标题 */
function fixture(configCode: string): void {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-config-env-')))
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view>首页</view></template>')
  fs.writeFileSync(path.join(root, 'pages.config.ts'), configCode)
  vi.stubEnv('VITE_ROOT_DIR', root)
  vi.stubEnv('UNI_PLATFORM', 'h5')
}

function title(): unknown {
  const pages = parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as any
  return pages.globalStyle?.navigationBarTitleText
}

afterEach(() => {
  vi.unstubAllEnvs()
  if (root)
    fs.rmSync(root, { recursive: true, force: true })
})

describe('配置图里的 import.meta.env', () => {
  it('在 Vite 会话里读到 .env 文件的前缀变量和标准键', async () => {
    fixture('export default { globalStyle: { navigationBarTitleText: import.meta.env.VITE_TITLE + \'/\' + import.meta.env.MODE } }')
    fs.writeFileSync(path.join(root, '.env.staging'), 'VITE_TITLE=from-env-file\n')
    await resolveConfig({ root, configFile: false, logLevel: 'silent', mode: 'staging', plugins: [UniPages({ dts: false })] }, 'build')
    expect(title()).toBe('from-env-file/staging')
  })

  it('prepare() 在没有 Vite 配置时退回进程环境', async () => {
    fixture('export default { globalStyle: { navigationBarTitleText: import.meta.env.VITE_TITLE } }')
    vi.stubEnv('VITE_TITLE', 'from-shell')
    await UniPages({ dts: false }).prepare({ platformSuffix: false })
    expect(title()).toBe('from-shell')
  })
})
