import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const corePkg = path.join(root, 'packages/core')
const typesPkg = path.join(root, 'packages/types')
// 直接跑仓库装好的 tsc。走 `npx` 要多起 cmd.exe 和 npm，Windows CI 上
// 光这条启动链就要十秒上下，测试还没跑完就撞破默认超时。
const tsc = path.join(root, 'node_modules/typescript/lib/tsc.js')

/**
 * https://github.com/uni-helper/vite-plugin-uni-pages/issues/281 的回归测试
 *
 * `definePage` 通过 `global.d.ts` 暴露为全局：
 *   declare global { const definePage: import('.').DefinePage }
 *
 * 这条链从 `/client` 子路径进入：消费者把
 * `@uni-helper/vite-plugin-uni-pages/client` 加进 tsconfig 的 `types`
 * 数组（或使用三斜线引用）。`client.d.ts` 引入 `global.d.ts`，其中的
 * `import('.')` 解析到包入口，因此入口必须把 `DefinePage` 暴露为可
 * 解析的类型。v0.4.2 的 dts 产物丢了该导出，产生 `TS2304: Cannot
 * find name 'definePage'`。
 *
 * 本测试重建发布面（`package.json` + 顶层 `.d.ts` + 构建后的
 * `dist/`），对一个最小消费者运行 `tsc --noEmit`，模拟 uni-demo
 * 消费该包的方式。
 */
describe('definePage global type (issue #281)', () => {
  const dirs: string[] = []

  afterAll(() => {
    for (const dir of dirs)
      rmSync(dir, { recursive: true, force: true })
  })

  // 拉起独立进程做完整类型检查，默认的 5s 超时对 Windows CI 太紧。
  it('resolves `definePage` from the published package surface', () => {
    // 构建产物必须存在；CI 在 `test` 之前运行 `build`。
    expect(existsSync(path.join(corePkg, 'dist/index.d.mts')), 'core dist missing, run `pnpm build` first').toBe(true)
    expect(existsSync(path.join(typesPkg, 'dist/index.d.mts')), 'types dist missing, run `pnpm build` first').toBe(true)

    const tmp = mkdtempSync(path.join(tmpdir(), 'uni-pages-types-'))
    dirs.push(tmp)

    // 在消费者 `node_modules` 内重建两个包的发布布局，
    // 与 `tsconfig.types` 解析插件的方式一致。
    const coreOut = path.join(tmp, 'node_modules/@uni-helper/vite-plugin-uni-pages')
    const typesOut = path.join(tmp, 'node_modules/@uni-helper/uni-pages-types')
    mkdirSync(coreOut, { recursive: true })
    mkdirSync(typesOut, { recursive: true })
    for (const file of ['package.json', 'client.d.ts', 'global.d.ts'])
      cpSync(path.join(corePkg, file), path.join(coreOut, file))
    cpSync(path.join(corePkg, 'dist'), path.join(coreOut, 'dist'), { recursive: true })
    cpSync(path.join(typesPkg, 'package.json'), path.join(typesOut, 'package.json'))
    cpSync(path.join(typesPkg, 'dist'), path.join(typesOut, 'dist'), { recursive: true })

    // 最小消费者项目。普通 `.ts` 文件模拟 `<script setup>` 中的
    // definePage 宏调用；原生 `tsc` 无法解析 `.vue`，这里只需断言
    // 全局类型能解析。
    mkdirSync(path.join(tmp, 'src'))
    writeFileSync(
      path.join(tmp, 'src/page.ts'),
      [
        '// 模拟 `<script setup>` 中调用 definePage 宏。',
        'definePage({ style: { navigationBarTitleText: \'Home\' } })',
      ].join('\n'),
    )

    writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          types: ['@uni-helper/vite-plugin-uni-pages/client'],
        },
        include: ['src/**/*'],
      }, null, 2),
    )

    let stdout = ''
    let exitCode = 0
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '-p', tmp], {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    catch (error: any) {
      exitCode = error.status ?? 1
      stdout = [error.stdout, error.stderr].filter(Boolean).join('\n')
    }

    expect(exitCode, `tsc failed:\n${stdout}`).toBe(0)
    expect(stdout).not.toMatch(/TS2304|Cannot find name 'definePage'/)

    // 健全性检查：全局声明确实通过 global.d.ts 接好了。
    const globalDts = readFileSync(path.join(coreOut, 'global.d.ts'), 'utf-8')
    expect(globalDts).toMatch(/const definePage: import\(['"]\.['"]\)\.DefinePage/)
  }, 60_000)
})
