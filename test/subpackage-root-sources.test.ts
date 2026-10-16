import type { SubPackageConfig } from '../packages/core/src'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveOptions } from '../packages/core/src'
import { getSubPackageDirectorySources, refreshPageDirectories } from '../packages/core/src/directories'

const fixtures: string[] = []

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-root-sources-'))
  fixtures.push(root)
  fs.mkdirSync(path.join(root, 'src/real'), { recursive: true })
  return root
}

function alias(root: string): void {
  fs.symlinkSync(path.join(root, 'src/real'), path.join(root, 'src/alias'), 'junction')
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('分包目录 root 来源', () => {
  it.each([
    { reverse: false, callback: false },
    { reverse: true, callback: false },
    { reverse: false, callback: true },
    { reverse: true, callback: true },
  ])('显式 root 优先于同目录默认 root，反向声明=$reverse，使用回调=$callback', ({ reverse, callback }) => {
    const root = fixture()
    const patterns: (string | SubPackageConfig)[] = ['src/real', { dir: 'src/real', root: callback ? () => 'pkg' : 'pkg' }]
    const options = resolveOptions({ subPackages: reverse ? patterns.reverse() : patterns }, root)

    expect(options.subPackages).toEqual(['src/real'])
    expect(options.subPackageRootMap.get('src/real')).toBe('pkg')
  })

  it.each([false, true])('别名目录共享显式 root，保留各自词法路径，反向声明=%s', (reverse) => {
    const root = fixture()
    alias(root)
    const patterns: (string | SubPackageConfig)[] = ['src/alias', { dir: 'src/real', root: 'pkg' }]
    const options = resolveOptions({ subPackages: reverse ? patterns.reverse() : patterns }, root)

    expect(options.subPackages).toEqual(reverse ? ['src/real', 'src/alias'] : ['src/alias', 'src/real'])
    expect(options.subPackageRootMap.get('src/alias')).toBe('pkg')
    expect(options.subPackageRootMap.get('src/real')).toBe('pkg')
  })

  it('固定 root 和回调结果同级，同值合并、异值定位双方声明', () => {
    const root = fixture()
    alias(root)
    const received: string[] = []
    const patterns: SubPackageConfig[] = [
      { dir: 'src/alias', root: 'pkg' },
      {
        dir: 'src/real',
        root: (dir) => {
          received.push(dir)
          return 'pkg'
        },
      },
    ]
    const options = resolveOptions({ subPackages: patterns }, root)
    expect(received).toEqual(['src/real'])
    expect([...options.subPackageRootMap.values()]).toEqual(['pkg', 'pkg'])

    patterns[1] = { dir: 'src/real', root: () => 'other' }
    expect(() => resolveOptions({ subPackages: patterns }, root)).toThrow(/Conflicting subpackage roots.*src\/alias.*pkg.*src\/real.*other/)
  })

  it('默认别名 root 按稳定来源顺序选择，输出仍使用词法路径', () => {
    const root = fixture()
    alias(root)
    const options = resolveOptions({ subPackages: ['src/alias', 'src/real'] }, root)

    expect(options.subPackages).toEqual(['src/alias', 'src/real'])
    expect(options.subPackageRootMap.get('src/real')).toBe('alias')
  })

  it('目录排除先于身份分组，被排除的显式来源不接管默认 root', () => {
    const root = fixture()
    alias(root)
    const options = resolveOptions({
      subPackages: [{ dir: 'src/alias', root: 'pkg' }, 'src/real'],
      exclude: ['src/alias'],
    }, root)

    expect(options.subPackages).toEqual(['src/real'])
    expect(options.subPackageRootMap.has('src/real')).toBe(false)
  })

  it('缺失静态目录保留投影及纯声明 root 决议', () => {
    const root = fixture()
    const options = resolveOptions({ subPackages: ['src/missing', { dir: 'src/missing', root: 'pkg' }] }, root)
    expect(options.subPackages).toEqual(['src/missing'])
    expect(options.subPackageRootMap.get('src/missing')).toBe('pkg')

    expect(() => resolveOptions({ subPackages: [{ dir: 'src/missing', root: 'first' }, { dir: 'src/missing', root: 'second' }] }, root)).toThrow('Conflicting subpackage roots')
  })

  it('缺失的回调目录仍不产生候选或执行回调', () => {
    const root = fixture()
    const received: string[] = []
    const options = resolveOptions({
      subPackages: [{
        dir: 'src/missing',
        root: (dir) => {
          received.push(dir)
          return 'pkg'
        },
      }],
    }, root)

    expect(options.subPackages).toEqual([])
    expect(received).toEqual([])
  })

  it('文件级排除不删目录来源，默认别名仍沿用显式目录 root', () => {
    const root = fixture()
    alias(root)
    fs.writeFileSync(path.join(root, 'src/real/foo.vue'), '<template><view /></template>')
    const options = resolveOptions({
      subPackages: ['src/alias', { dir: 'src/real', root: 'pkg' }],
      exclude: ['src/real/foo.vue'],
    }, root)
    refreshPageDirectories(options)
    const sources = getSubPackageDirectorySources(options)

    expect(sources.map(({ dir, root, explicitRoot, ruleIndex, matchIndex }) => ({ dir, root, explicitRoot, ruleIndex, matchIndex }))).toEqual([
      { dir: 'src/alias', root: 'pkg', explicitRoot: false, ruleIndex: 0, matchIndex: 0 },
      { dir: 'src/real', root: 'pkg', explicitRoot: true, ruleIndex: 1, matchIndex: 0 },
    ])
    expect(sources[0]!.absolute).not.toBe(sources[1]!.absolute)
    expect(sources[0]!.identity).toBe(sources[1]!.identity)
    expect(sources.map(source => source.rootSource)).toEqual([
      { dir: 'src/real', ruleIndex: 1, explicitRoot: true },
      { dir: 'src/real', ruleIndex: 1, explicitRoot: true },
    ])
  })

  it('重复声明保留各自 root 意图和位置，兼容目录投影只登记一次', () => {
    const root = fixture()
    const options = resolveOptions({ subPackages: ['src/real', { dir: 'src/real', root: 'pkg' }] }, root)
    refreshPageDirectories(options)

    expect(options.subPackages).toEqual(['src/real'])
    expect(getSubPackageDirectorySources(options).map(source => [source.explicitRoot, source.ruleIndex, source.root])).toEqual([
      [false, 0, 'pkg'],
      [true, 1, 'pkg'],
    ])
  })

  it('缺失目录不伪造 identity，目录出现及别名换目标后每轮重新解析', () => {
    const root = fixture()
    const options = resolveOptions({ subPackages: ['src/missing'] }, root)
    refreshPageDirectories(options)
    expect(getSubPackageDirectorySources(options)[0]!.identity).toBeUndefined()
    fs.mkdirSync(path.join(root, 'src/missing'))
    refreshPageDirectories(options)
    expect(getSubPackageDirectorySources(options)[0]!.identity).toBeDefined()

    alias(root)
    options.subPackagePatterns = [{ dir: 'src/alias', root: 'pkg' }]
    refreshPageDirectories(options)
    const previousIdentity = getSubPackageDirectorySources(options)[0]!.identity
    fs.unlinkSync(path.join(root, 'src/alias'))
    fs.symlinkSync(path.join(root, 'src/missing'), path.join(root, 'src/alias'), 'junction')
    refreshPageDirectories(options)
    expect(getSubPackageDirectorySources(options)[0]!.identity).not.toBe(previousIdentity)
  })

  it('别名各自执行 root 回调，不在回调前按 identity 去重', () => {
    const root = fixture()
    alias(root)
    const received: string[] = []
    const rootFor = (dir: string): string => {
      received.push(dir)
      return dir.endsWith('alias') ? 'first' : 'second'
    }
    expect(() => resolveOptions({ subPackages: [{ dir: 'src/alias', root: rootFor }, { dir: 'src/real', root: rootFor }] }, root)).toThrow('Conflicting subpackage roots')
    expect(received).toEqual(['src/alias', 'src/real'])
  })
})
