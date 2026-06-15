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

/**
 * Regression test for https://github.com/uni-helper/vite-plugin-uni-pages/issues/281
 *
 * `definePage` is exposed as a global via `global.d.ts`:
 *   declare global { const definePage: import('.').DefinePage }
 *
 * `import('.')` resolves to the package entry, so the entry must expose
 * `DefinePage` as a resolvable type. In v0.4.2 the entry used
 * `export type * from './dist/index.d.mts'`, which does not constitute a
 * resolvable module surface under `moduleResolution: bundler`, and
 * `package.json` `exports['.'].types` pointed at `./dist/index.d.mts`
 * directly, bypassing `index.d.ts`. Both broke `import('.').DefinePage`,
 * producing `TS2304: Cannot find name 'definePage'`.
 *
 * This test reconstructs the published surface (`package.json` + top-level
 * `.d.ts` + built `dist/`) and runs `tsc --noEmit` against a minimal
 * consumer, mirroring how `uni-demo` consumes the package.
 */
describe('definePage global type (issue #281)', () => {
  const dirs: string[] = []

  afterAll(() => {
    for (const dir of dirs)
      rmSync(dir, { recursive: true, force: true })
  })

  it('resolves `definePage` from the published package surface', () => {
    // Built artifacts must exist; CI runs `build` before `test`.
    expect(existsSync(path.join(corePkg, 'dist/index.d.mts')), 'core dist missing, run `pnpm build` first').toBe(true)
    expect(existsSync(path.join(typesPkg, 'dist/index.d.mts')), 'types dist missing, run `pnpm build` first').toBe(true)

    const tmp = mkdtempSync(path.join(tmpdir(), 'uni-pages-types-'))
    dirs.push(tmp)

    // Reconstruct the published layout of both packages inside a consumer
    // `node_modules`, matching how `tsconfig.types` resolves the plugin.
    const coreOut = path.join(tmp, 'node_modules/@uni-helper/vite-plugin-uni-pages')
    const typesOut = path.join(tmp, 'node_modules/@uni-helper/uni-pages-types')
    mkdirSync(coreOut, { recursive: true })
    mkdirSync(typesOut, { recursive: true })
    for (const file of ['package.json', 'index.d.ts', 'client.d.ts', 'global.d.ts'])
      cpSync(path.join(corePkg, file), path.join(coreOut, file))
    cpSync(path.join(corePkg, 'dist'), path.join(coreOut, 'dist'), { recursive: true })
    cpSync(path.join(typesPkg, 'package.json'), path.join(typesOut, 'package.json'))
    cpSync(path.join(typesPkg, 'dist'), path.join(typesOut, 'dist'), { recursive: true })

    // Minimal consumer project. A plain `.ts` file mirrors the
    // `<script setup>` definePage macro call; plain `tsc` cannot parse
    // `.vue` and we only need to assert the global type resolves.
    mkdirSync(path.join(tmp, 'src'))
    writeFileSync(
      path.join(tmp, 'src/page.ts'),
      [
        '// Mirage of `<script setup>` calling the definePage macro.',
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
          types: ['@uni-helper/vite-plugin-uni-pages'],
        },
        include: ['src/**/*'],
      }, null, 2),
    )

    let stdout = ''
    let exitCode = 0
    try {
      execFileSync('npx', ['tsc', '--noEmit', '-p', tmp], {
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

    // Sanity: the global declaration is actually wired up via global.d.ts.
    const globalDts = readFileSync(path.join(coreOut, 'global.d.ts'), 'utf-8')
    expect(globalDts).toMatch(/const definePage: import\(['"]\.['"]\)\.DefinePage/)
  })
})
