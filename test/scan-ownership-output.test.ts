import type { PageContext, UserOptions } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'comment-json'
import { afterEach, describe, expect, it } from 'vitest'
import { generateAll } from '../packages/core/src'

interface OutputPage {
  path: string
  style?: Record<string, unknown>
  middlewares?: string[]
}

interface OutputPackage {
  root: string
  pages: OutputPage[]
  plugins?: Record<string, unknown>
}

interface Output {
  pages: OutputPage[]
  subPackages?: OutputPackage[]
}

const roots: string[] = []

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-ownership-output-'))
  roots.push(root)
  page(root, 'src/pages/index.vue', { type: 'home' })
  return root
}

function page(root: string, name: string, meta: Record<string, unknown>): void {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<script setup>definePage(${JSON.stringify(meta)})</script><template><view /></template>`)
}

function config(root: string, value: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, 'pages.config.ts'), `export default ${JSON.stringify(value)}`)
}

function readOutput(root: string): Output {
  return parse(fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8')) as unknown as Output
}

function routes(output: Output): string[] {
  return [
    ...output.pages.map(page => page.path),
    ...output.subPackages?.flatMap(pkg => pkg.pages.map(page => path.posix.join(pkg.root, page.path))) ?? [],
  ].sort()
}

async function expectConsistentOutputs(root: string, ctx: PageContext, expected: string[]): Promise<void> {
  const virtualUrl = `data:text/javascript,${encodeURIComponent(ctx.virtualModule())}`
  const virtual = await import(virtualUrl) as Output
  const declaration = fs.readFileSync(path.join(root, 'uni-pages.d.ts'), 'utf8')
  const declared = [...declaration.matchAll(/"\/([^"\n]+)"/g)].map(match => match[1]).sort()
  expect(routes(readOutput(root))).toEqual(expected)
  expect(routes(virtual)).toEqual(expected)
  expect(declared).toEqual(expected)
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('扫描归属的生成产物', () => {
  it('先按 root 聚合，再保留部分配置覆盖、扫描元数据、手工页面与 plugins', async () => {
    const root = fixture()
    page(root, 'src/first/detail.vue', {
      path: 'bundle/first',
      style: { navigationBarTitleText: '扫描标题', navigationBarBackgroundColor: '#123456' },
      middlewares: ['scan-first'],
    })
    page(root, 'src/second/detail.vue', { path: 'bundle/second', middlewares: ['scan-second'] })
    const plugins = { demo: { version: '1', provider: 'demo' } }
    config(root, {
      subPackages: [
        {
          root: 'bundle',
          pages: [
            { path: 'first', style: { navigationBarTitleText: '配置标题' } },
            { path: 'manual', style: { navigationBarTitleText: '手工页面' } },
          ],
          plugins,
        },
        { root: 'config-only', pages: [{ path: 'index' }], plugins },
      ],
    })

    const { ctx } = await generateAll({
      subPackages: [{ dir: 'src/first', root: 'bundle' }, { dir: 'src/second', root: 'bundle' }],
    }, { root, platform: 'h5' })

    const output = readOutput(root)
    const bundle = output.subPackages!.find(pkg => pkg.root === 'bundle')!
    expect(bundle.pages.find(page => page.path === 'first')).toMatchObject({
      style: { navigationBarTitleText: '配置标题' },
      middlewares: ['scan-first'],
    })
    expect(bundle.pages.find(page => page.path === 'second')).toMatchObject({ middlewares: ['scan-second'] })
    expect(bundle.plugins).toEqual(plugins)
    expect(output.subPackages!.find(pkg => pkg.root === 'config-only')!.plugins).toEqual(plugins)
    await expectConsistentOutputs(root, ctx, ['bundle/first', 'bundle/manual', 'bundle/second', 'config-only/index', 'pages/index'])
  })

  it.each([false, true])('别名排除先于页面归属，调换来源顺序=%s 时三个产物仍完整且不重复', async (reverse) => {
    const root = fixture()
    page(root, 'src/real/foo.vue', { path: 'bundle/foo', middlewares: ['foo'] })
    page(root, 'src/real/bar.vue', { path: 'bundle/bar', middlewares: ['bar'] })
    fs.symlinkSync(path.join(root, 'src/real'), path.join(root, 'src/alias'), 'junction')
    const subPackages = ['src/alias', 'src/real'].map(dir => ({ dir, root: 'bundle' }))
    if (reverse)
      subPackages.reverse()

    const { ctx } = await generateAll({ subPackages, exclude: ['src/alias/foo.vue'] }, { root, platform: 'h5' })

    await expectConsistentOutputs(root, ctx, ['bundle/bar', 'bundle/foo', 'pages/index'])
  })

  it('空的动态来源消失后，静态同 root 的页面不会从生成产物消失', async () => {
    const root = fixture()
    page(root, 'src/first/detail.vue', { path: 'bundle/first' })
    page(root, 'src/second/detail.vue', { path: 'bundle/second' })
    fs.mkdirSync(path.join(root, 'src/dynamic/empty'), { recursive: true })
    const options: UserOptions = {
      subPackages: [
        { dir: 'src/first', root: 'bundle' },
        { dir: 'src/second', root: 'bundle' },
        { dir: 'src/dynamic/*', root: 'bundle' },
      ],
    }
    const expected = ['bundle/first', 'bundle/second', 'pages/index']
    const { ctx } = await generateAll(options, { root, platform: 'h5' })
    await expectConsistentOutputs(root, ctx, expected)

    fs.rmSync(path.join(root, 'src/dynamic/empty'), { recursive: true })
    await ctx.updatePagesJSON()

    await expectConsistentOutputs(root, ctx, expected)
  })

  it.each(['subpackage', 'main'] as const)('%s 来源的完整路由冲突不能被配置覆盖掩盖，也不覆盖已有产物', async (source) => {
    const root = fixture()
    await generateAll({}, { root, platform: 'h5' })
    const pagesPath = path.join(root, 'src/pages.json')
    const declarationPath = path.join(root, 'uni-pages.d.ts')
    const previousPages = fs.readFileSync(pagesPath, 'utf8')
    const previousDeclaration = fs.readFileSync(declarationPath, 'utf8')
    page(root, 'src/first/first.vue', { path: 'bundle/shared' })
    const second = source === 'main' ? 'src/pages/second.vue' : 'src/second/second.vue'
    page(root, second, { path: 'bundle/./shared' })
    config(root, { subPackages: [{ root: 'bundle', pages: [{ path: 'shared', style: { navigationBarTitleText: '配置覆盖' } }] }] })
    const subPackages = [{ dir: 'src/first', root: 'bundle' }]
    if (source === 'subpackage')
      subPackages.push({ dir: 'src/second', root: 'bundle' })

    const error = await generateAll({ subPackages }, { root, platform: 'h5' }).then(() => undefined, error => error as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/route/i)
    expect(error!.message).toContain('first.vue')
    expect(error!.message).toContain('second.vue')
    expect(error!.message).toContain('bundle')
    expect(fs.readFileSync(pagesPath, 'utf8')).toBe(previousPages)
    expect(fs.readFileSync(declarationPath, 'utf8')).toBe(previousDeclaration)
  })
})
