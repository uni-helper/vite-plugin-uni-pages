import path from 'node:path'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { normalizeConfigPath } from '../packages/core/src/config-loader'
import { buildConfigWatchPlan, ConfigWatchIndex } from '../packages/core/src/config-watch'
import { createFixture } from './helpers/fixture'

function fixture() {
  const workspace = createFixture('uni-pages-config-watch-')
  workspace.write('node_modules/.cache/uni-pages/.keep', '')
  workspace.write('config/.keep', '')
  workspace.writeConfig('export default {}', 'pages.config.ts')
  workspace.writeConfig('export default {}', 'leaf.ts')
  return {
    workspace,
    root: workspace.root,
    artifactDirectory: normalizeConfigPath(workspace.path('node_modules/.cache/uni-pages'), workspace.root),
  }
}

describe('配置监听计划', () => {
  it('归一化文件、补入父目录，并排除加载器产物', () => {
    const { root, artifactDirectory } = fixture()
    const artifact = normalizeConfigPath(path.join(root, 'node_modules/.cache/uni-pages/load/config.mjs'), root)
    const plan = buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: ['./config/../leaf.ts', artifact],
      recoveryCandidates: ['config/title.ts'],
      recoveryDirectories: ['config'],
    })

    expect(plan.files).toEqual([
      normalizeConfigPath('pages.config.ts', root),
      normalizeConfigPath('leaf.ts', root),
      normalizeConfigPath('config/title.ts', root),
    ])
    expect(plan.files).not.toContain(artifact)
    expect(plan.directories).toEqual([normalizeConfigPath('config', root)])
    expect(plan.paths).toEqual(expect.arrayContaining([
      normalizeConfigPath('pages.config.ts', root),
      normalizeConfigPath('leaf.ts', root),
      normalizeConfigPath('config', root),
      normalizeConfigPath('.', root),
    ]))
  })

  it('直接命中、冗余路径段与恢复目录都按配置事件处理', () => {
    const { root, artifactDirectory } = fixture()
    const plan = buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: ['leaf.ts'],
      recoveryDirectories: ['config'],
    })
    const index = new ConfigWatchIndex(root, artifactDirectory)
    index.update(plan)

    expect(index.match('pages.config.ts', [])).toBe(normalizeConfigPath('pages.config.ts', root))
    expect(index.match('config/../pages.config.ts', [])).toBe(normalizeConfigPath('pages.config.ts', root))
    expect(index.match('config/custom.ts', [])).toBe(normalizeConfigPath('config/custom.ts', root))
    expect(index.match('config/custom.json', [])).toBe(normalizeConfigPath('config/custom.json', root))
    expect(index.match('config/custom.txt', [])).toBeUndefined()
    expect(index.match('untracked.ts', [])).toBeUndefined()
  })

  it('恢复目录按路径段匹配，不误伤共享前缀的兄弟目录', () => {
    const { root, artifactDirectory } = fixture()
    const index = new ConfigWatchIndex(root, artifactDirectory)
    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: [],
      recoveryDirectories: ['config'],
    }))

    expect(index.match('config-other/custom.ts', [])).toBeUndefined()
    expect(index.match('config/nested/custom.ts', [])).toBe(normalizeConfigPath('config/nested/custom.ts', root))
  })

  it('生成物和加载器产物永远不匹配', () => {
    const { root, artifactDirectory } = fixture()
    const index = new ConfigWatchIndex(root, artifactDirectory)
    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: ['leaf.ts'],
    }))

    const generated = normalizeConfigPath('src/pages.json', root)
    const artifact = normalizeConfigPath('node_modules/.cache/uni-pages/load/config.mjs', root)
    expect(index.match('src/pages.json', [generated])).toBeUndefined()
    expect(index.match(artifact, [])).toBeUndefined()
  })

  it('共享根目录下的路径不重复注册，依赖扩大只消费一次', () => {
    const { root, artifactDirectory } = fixture()
    const index = new ConfigWatchIndex(root, artifactDirectory)
    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: [],
    }))
    expect(index.watchPaths(normalizeConfigPath('.', root))).toEqual([])
    expect(index.consumeExpanded()).toBe(false)

    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: ['leaf.ts'],
    }))
    expect(index.consumeExpanded()).toBe(true)
    expect(index.consumeExpanded()).toBe(false)
    expect(index.watchPaths()).toContain(normalizePath(path.join(root, 'leaf.ts')))
  })

  it('依赖集合缩小不算扩大，不会触发补跑', () => {
    const { root, artifactDirectory } = fixture()
    const index = new ConfigWatchIndex(root, artifactDirectory)
    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: ['leaf.ts'],
    }))
    index.consumeExpanded()

    index.update(buildConfigWatchPlan({
      root,
      artifactDirectory,
      sourcePaths: ['pages.config.ts'],
      dependencyPaths: [],
    }))

    expect(index.consumeExpanded()).toBe(false)
  })
})
