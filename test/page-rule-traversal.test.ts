import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { compilePageRules } from '../packages/core/src/page-rules'

const root = path.resolve('page-rule-traversal')
const source = (relative: string): string => path.resolve(root, relative)

describe('单轮遍历的页面排除查询', () => {
  it('共用祖先只匹配一次，新遍历独立计算', () => {
    const exclude = ['**/node_modules/**', '**/.git/**', '**/dist/**']
    const rules = compilePageRules(root, ['src/pages'], exclude)
    const paths = [source('src/pages')]
    for (let index = 0; index < 40; index++) {
      paths.push(source(`src/pages/section-${index}`))
      paths.push(source(`src/pages/section-${index}/assets`))
    }
    const ancestors = new Set<string>()
    for (const file of paths) {
      let directory = file
      while (true) {
        ancestors.add(directory)
        const parent = path.dirname(directory)
        if (parent === directory)
          break
        directory = parent
      }
    }
    const relative = vi.spyOn(path, 'relative')
    try {
      const isExcluded = rules.createExcludeFilter()
      for (const file of paths)
        expect(isExcluded(file)).toBe(false)
      const firstPass = relative.mock.calls.length
      expect(firstPass).toBe(ancestors.size * exclude.length)

      for (const file of paths.toReversed())
        expect(isExcluded(file)).toBe(false)
      expect(relative).toHaveBeenCalledTimes(firstPass)

      const nextTraversal = rules.createExcludeFilter()
      for (const file of paths)
        expect(nextTraversal(file)).toBe(false)
      expect(relative).toHaveBeenCalledTimes(firstPass * 2)
    }
    finally {
      relative.mockRestore()
    }
  })

  it.each([
    [],
    ['src/pages/private'],
    ['src/pages/private/**'],
    [source('src/pages/private')],
    ['src/pages/@(private|secret)/**'],
    ['../outside'],
    ['**/.hidden/**'],
    [''],
  ])('排除规则 %j 的父子和独立词法路径结果保持一致', (...exclude) => {
    const rules = compilePageRules(root, ['src/pages'], exclude)
    const isExcluded = rules.createExcludeFilter()
    const paths = [
      'src/pages',
      'src/pages/private',
      'src/pages/private/index.vue',
      'src/pages/private-other/index.vue',
      'src/pages/public/index.vue',
      'src/pages/secret/nested/index.vue',
      'src/pages/.hidden/index.vue',
      '../outside/pages/index.vue',
      '../outside-other/index.vue',
    ].map(source)
    for (const ordered of [paths, paths.toReversed(), paths]) {
      for (const file of ordered)
        expect(isExcluded(file)).toBe(rules.isExcluded(file))
    }
  })
})
