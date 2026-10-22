import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createPageWatchFilter } from '../packages/core/src/page-watch-filter'

const root = path.resolve('test/fixtures/watch-filter')
const lexical = (file: string): string => path.join(root, file)

describe('页面监听的 Vite 过滤规则', () => {
  it('空规则不忽略路径', () => {
    const ignored = createPageWatchFilter(undefined, root)
    expect(ignored(lexical('src/pages/index.vue'))).toBe(false)
  })

  it('glob 按完整词法路径匹配并包含隐藏目录', () => {
    const ignored = createPageWatchFilter('**/pages/**', root)
    expect(ignored(lexical('src/pages'))).toBe(true)
    expect(ignored(lexical('.hidden/pages/index.vue'))).toBe(true)
    expect(ignored(lexical('src/pages-other/index.vue'))).toBe(false)
  })

  it('绝对字面目录规则忽略自身和后代，保留相邻目录', () => {
    const ignored = createPageWatchFilter(lexical('src/pages'), root)
    expect(ignored(lexical('src/pages'))).toBe(true)
    expect(ignored(lexical('src/pages/nested/index.vue'))).toBe(true)
    expect(ignored(lexical('src/pages-other/index.vue'))).toBe(false)
  })

  it('正则与函数规则组成忽略集合，函数收到词法路径和文件信息', () => {
    const stats = fs.statSync(path.dirname(import.meta.dirname))
    const matcher = vi.fn((file: string, stat?: fs.Stats) => file.endsWith('/pages') && !!stat?.isDirectory())
    const ignored = createPageWatchFilter([/\/generated\//, matcher], root)
    expect(ignored(lexical('generated/index.vue'))).toBe(true)
    expect(ignored(lexical('src/pages'))).toBe(false)
    expect(ignored(lexical('src/pages'), stats)).toBe(true)
    expect(matcher).toHaveBeenLastCalledWith(normalizePath(lexical('src/pages')), stats)
    expect(ignored(lexical('shared'), stats)).toBe(false)
  })

  it('否定模式优先于 glob、正则和函数规则，顺序不影响结果', () => {
    for (const patterns of [
      ['**/pages/**', '!**/pages/public/**'],
      ['!**/pages/public/**', '**/pages/**'],
      [/\/pages\//, '!**/pages/public/**'],
      [() => true, '!**/pages/public/**'],
    ]) {
      const ignored = createPageWatchFilter(patterns, root)
      expect(ignored(lexical('src/pages/private/index.vue'))).toBe(true)
      expect(ignored(lexical('src/pages/public/index.vue'))).toBe(false)
    }
  })

  it('否定字面目录只解除目录自身的忽略，不解除后代', () => {
    const directory = normalizePath(lexical('src/pages'))
    const ignored = createPageWatchFilter(['**/pages/**', `!${directory}`], root)
    expect(ignored(directory)).toBe(false)
    expect(ignored(path.join(directory, 'index.vue'))).toBe(true)
  })

  it('只有否定模式时不产生忽略范围', () => {
    const ignored = createPageWatchFilter('!**/public/**', root)
    expect(ignored(lexical('src/pages/private/index.vue'))).toBe(false)
    expect(ignored(lexical('src/pages/public/index.vue'))).toBe(false)
  })

  it('相对字符串默认按 process.cwd 展开，显式 cwd 优先', () => {
    const file = lexical('src/pages/index.vue')
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      expect(createPageWatchFilter('src/pages/**', root)(file)).toBe(true)
    }
    finally {
      cwd.mockRestore()
    }
    expect(createPageWatchFilter('src/pages/**', root)(file)).toBe(false)
    expect(createPageWatchFilter('src/pages/**', root, root)(file)).toBe(true)
    expect(createPageWatchFilter('src/pages', root, root)(file)).toBe(true)
  })

  it('相对否定规则解析后仍保留否定语义', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      const ignored = createPageWatchFilter(['src/pages/**', '!src/pages/public/**'], root)
      expect(ignored(lexical('src/pages/private/index.vue'))).toBe(true)
      expect(ignored(lexical('src/pages/public/index.vue'))).toBe(false)
    }
    finally {
      cwd.mockRestore()
    }
  })

  it('候选相对路径以项目 root 解析，匹配过程不依赖真实目标', () => {
    const ignored = createPageWatchFilter('**/pages/**', root)
    expect(ignored('src/pages/../pages/index.vue')).toBe(true)
    expect(ignored('shared/index.vue')).toBe(false)
  })
})
