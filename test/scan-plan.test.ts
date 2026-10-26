import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOptions } from '../packages/core/src/options'
import { applyScanPlan, createScanPlan } from '../packages/core/src/scan-plan'
import { createFixture } from './helpers/fixture'

function fixture() {
  const workspace = createFixture('uni-pages-scan-plan-')
  workspace.writePage('src/pages/index.vue')
  return workspace
}

describe('扫描计划', () => {
  it('一次发现主包、分包来源、root 与规则', () => {
    const workspace = fixture()
    workspace.writePage('src/pkg/a/pages/detail.vue')
    workspace.writePage('src/pkg/b/pages/detail.vue')
    const options = resolveOptions({
      dir: 'src/pages',
      subPackages: [{
        dir: 'src/pkg/*/pages',
        root: dir => `pkg-${dir.split('/')[2]}`,
      }],
    }, workspace.root)

    const plan = createScanPlan(options)

    expect(plan.root).toBe(options.root)
    expect(plan.basePath).toBe(path.join(workspace.root, 'src').replace(/\\/g, '/'))
    expect(plan.mainDirs).toEqual(['src/pages'])
    expect(plan.subPackageDirs).toEqual(['src/pkg/a/pages', 'src/pkg/b/pages'])
    expect(plan.subPackageSources.map(source => [source.dir, source.root, source.explicitRoot])).toEqual([
      ['src/pkg/a/pages', 'pkg-a', true],
      ['src/pkg/b/pages', 'pkg-b', true],
    ])
    expect(plan.subPackageRootMap.get('src/pkg/a/pages')).toBe('pkg-a')
    expect(plan.rules.matchesDirectory(workspace.path('src/pages'))).toBe(true)
    expect(plan.rules.isExcluded(workspace.path('src/pkg/a/pages/detail.vue'))).toBe(false)
  })

  it('计划随目录出现刷新，不保留上一轮的身份快照', () => {
    const workspace = fixture()
    const options = resolveOptions({ subPackages: ['src/packages/*/pages'] }, workspace.root)
    expect(createScanPlan(options).subPackageDirs).toEqual([])

    workspace.writePage('src/packages/account/pages/profile.vue')
    const plan = createScanPlan(options)

    expect(plan.subPackageDirs).toEqual(['src/packages/account/pages'])
    expect(plan.subPackageSources[0]!.identity).toBeDefined()
  })

  it('兼容投影同步回 ResolvedOptions', () => {
    const workspace = fixture()
    workspace.writePage('src/pkg/a/pages/detail.vue')
    const options = resolveOptions({
      subPackages: [{ dir: 'src/pkg/a/pages', root: 'pkg' }],
    }, workspace.root)

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
