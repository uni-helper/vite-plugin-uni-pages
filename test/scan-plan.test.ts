import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveOptions } from '../packages/core/src/options'
import { applyScanPlan, createScanPlan } from '../packages/core/src/scan-plan'

const roots: string[] = []

function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-scan-plan-')))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/pages/index.vue'), '<template><view /></template>')
  return root
}

function page(root: string, file: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), '<template><view /></template>')
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('扫描计划', () => {
  it('一次发现主包、分包来源、root 与规则', () => {
    const root = fixture()
    page(root, 'src/pkg/a/pages/detail.vue')
    page(root, 'src/pkg/b/pages/detail.vue')
    const options = resolveOptions({
      dir: 'src/pages',
      subPackages: [{
        dir: 'src/pkg/*/pages',
        root: dir => `pkg-${dir.split('/')[2]}`,
      }],
    }, root)

    const plan = createScanPlan(options)

    expect(plan.root).toBe(options.root)
    expect(plan.basePath).toBe(path.join(root, 'src').replace(/\\/g, '/'))
    expect(plan.mainDirs).toEqual(['src/pages'])
    expect(plan.subPackageDirs).toEqual(['src/pkg/a/pages', 'src/pkg/b/pages'])
    expect(plan.subPackageSources.map(source => [source.dir, source.root, source.explicitRoot])).toEqual([
      ['src/pkg/a/pages', 'pkg-a', true],
      ['src/pkg/b/pages', 'pkg-b', true],
    ])
    expect(plan.subPackageRootMap.get('src/pkg/a/pages')).toBe('pkg-a')
    expect(plan.rules.matchesDirectory(path.join(root, 'src/pages'))).toBe(true)
    expect(plan.rules.isExcluded(path.join(root, 'src/pkg/a/pages/detail.vue'))).toBe(false)
  })

  it('计划随目录出现刷新，不保留上一轮的身份快照', () => {
    const root = fixture()
    const options = resolveOptions({ subPackages: ['src/packages/*/pages'] }, root)
    expect(createScanPlan(options).subPackageDirs).toEqual([])

    page(root, 'src/packages/account/pages/profile.vue')
    const plan = createScanPlan(options)

    expect(plan.subPackageDirs).toEqual(['src/packages/account/pages'])
    expect(plan.subPackageSources[0]!.identity).toBeDefined()
  })

  it('兼容投影同步回 ResolvedOptions', () => {
    const root = fixture()
    page(root, 'src/pkg/a/pages/detail.vue')
    const options = resolveOptions({
      subPackages: [{ dir: 'src/pkg/a/pages', root: 'pkg' }],
    }, root)

    const plan = createScanPlan(options)
    options.dirs = []
    options.subPackages = []
    options.subPackageRootMap = new Map()
    applyScanPlan(options, plan)

    expect(options.dirs).toEqual(plan.mainDirs)
    expect(options.subPackages).toEqual(plan.subPackageDirs)
    expect(options.subPackageRootMap.get('src/pkg/a/pages')).toBe('pkg')
  })
})
