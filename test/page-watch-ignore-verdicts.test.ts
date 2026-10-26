import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { SourceIgnoreIndex } from '../packages/core/src/page-watch'

/**
 * 监听 ignored 判定的复用。
 *
 * 页面监听会沿候选路径逐级询问 Vite 的 ignored。共享祖先在一批页面
 * 之间重复出现，逐个 stat 会让启动和结构刷新变成“候选数 × 深度”次
 * 系统调用。这里锁定复用边界：一轮内同一路径只问一次，刷新时清空。
 */

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-ignore-')))
fs.mkdirSync(path.join(root, 'pages/blocked'), { recursive: true })
for (const file of ['pages/a.vue', 'pages/b.vue', 'pages/blocked/c.vue'])
  fs.writeFileSync(path.join(root, file), '')

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('监听 ignored 判定的复用', () => {
  it('共享祖先在一轮内只询问一次', () => {
    const ignored = vi.fn((_file: string) => false)
    const index = new SourceIgnoreIndex(ignored)

    index.matches(path.join(root, 'pages/a.vue'))
    index.matches(path.join(root, 'pages/b.vue'))

    const tested = ignored.mock.calls.map(call => call[0])
    expect(tested.length).toBeGreaterThan(2)
    expect(new Set(tested).size).toBe(tested.length)
  })

  it('clear 后重新询问，缓存期间不重复', () => {
    const ignored = vi.fn((_file: string) => false)
    const index = new SourceIgnoreIndex(ignored)
    const file = path.join(root, 'pages/a.vue')

    index.matches(file)
    const afterFirst = ignored.mock.calls.length
    index.matches(file)
    expect(ignored.mock.calls.length).toBe(afterFirst)

    index.clear()
    index.matches(file)
    expect(ignored.mock.calls.length).toBeGreaterThan(afterFirst)
  })

  it('父目录命中后，后代只询问自己一次', () => {
    const ignored = vi.fn((file: string) => file.endsWith('/blocked'))
    const index = new SourceIgnoreIndex(ignored)

    expect(index.matches(path.join(root, 'pages/blocked/c.vue'))).toBe(true)
    const afterFirst = ignored.mock.calls.length
    expect(index.matches(path.join(root, 'pages/blocked/other.vue'))).toBe(true)
    expect(ignored.mock.calls.length).toBe(afterFirst + 1)
  })

  it('不可读路径按忽略处理，缺失路径仍交给规则判断', () => {
    const ignored = vi.fn((_file: string, _stats?: fs.Stats) => true)
    const index = new SourceIgnoreIndex(ignored)
    const stat = vi.spyOn(fs, 'statSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    try {
      expect(index.matches('/virtual/uni-pages-denied')).toBe(true)
      expect(ignored).not.toHaveBeenCalled()
    }
    finally {
      stat.mockRestore()
    }

    const missing = path.join(root, 'pages/missing.vue')
    expect(index.matches(missing)).toBe(true)
    expect(ignored).toHaveBeenLastCalledWith(missing, undefined)
  })
})
