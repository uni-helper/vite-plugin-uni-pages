import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectPageWatchSources, PAGE_WATCH_SOURCE_LIMIT, resolveWatchTarget } from '../packages/core/src/page-watch-sources'

const roots: string[] = []
const directoryLink = (target: string, source: string): void => fs.symlinkSync(target, source, process.platform === 'win32' ? 'junction' : 'dir')

function workspace(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-watch-sources-')))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('监听目标解析', () => {
  it('已存在目标使用真实路径', () => {
    const root = workspace()
    const target = path.join(root, 'shared/pages')
    fs.mkdirSync(target, { recursive: true })
    const alias = path.join(root, 'alias')
    directoryLink(target, alias)

    expect(resolveWatchTarget(alias)).toMatchObject({
      target: normalizePath(target),
      exists: true,
      kind: 'directory',
    })
  })

  it.skipIf(process.platform === 'win32')('目标路径中的不可读目录按暂不可用处理，权限恢复后可重新解析', () => {
    const root = workspace()
    const locked = path.join(root, 'locked')
    const target = path.join(locked, 'inner')
    fs.mkdirSync(target, { recursive: true })
    const alias = path.join(root, 'alias')
    directoryLink(target, alias)
    fs.chmodSync(locked, 0o000)
    try {
      expect(resolveWatchTarget(alias)).toMatchObject({ exists: false })
    }
    finally {
      fs.chmodSync(locked, 0o755)
    }

    expect(resolveWatchTarget(alias)).toMatchObject({
      target: normalizePath(target),
      exists: true,
    })
  })

  it('链接读取竞态按悬空目标处理', () => {
    const root = workspace()
    const target = path.join(root, 'target')
    fs.mkdirSync(target)
    const alias = path.join(root, 'alias')
    directoryLink(target, alias)
    const readlink = fs.readlinkSync
    vi.spyOn(fs, 'readlinkSync').mockImplementation(((file: fs.PathLike) => {
      if (normalizePath(String(file)) === normalizePath(alias))
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return readlink(file)
    }) as typeof fs.readlinkSync)

    const result = resolveWatchTarget(alias)
    expect(result.exists).toBe(false)
    expect(result.links).toContain(normalizePath(alias))
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')('目标拼写大小写不同仍使用真实路径身份', () => {
    const root = workspace()
    fs.mkdirSync(path.join(root, 'Pages'))
    const alias = path.join(root, 'alias')
    directoryLink(path.join(root, 'pages'), alias)

    expect(resolveWatchTarget(alias).target).toBe(normalizePath(fs.realpathSync.native(alias)))
  })

  it.skipIf(process.platform !== 'darwin')('unicode 规范化不同的目标使用真实路径身份', () => {
    const root = workspace()
    const nfd = path.join(root, 'e\u0301')
    fs.mkdirSync(nfd)
    const alias = path.join(root, 'alias')
    directoryLink(path.join(root, '\u00E9'), alias)

    expect(resolveWatchTarget(alias).target).toBe(normalizePath(fs.realpathSync.native(alias)))
  })
})

describe('监听来源发现上限', () => {
  it('别名层叠超过安全上限时停止展开并标记截断', () => {
    const root = workspace()
    const pages = path.join(root, 'pages')
    fs.mkdirSync(pages)
    let previous = pages
    for (let level = 0; level < 13; level++) {
      const next = path.join(root, `level-${level}`)
      fs.mkdirSync(next)
      directoryLink(next, path.join(previous, 'a'))
      directoryLink(next, path.join(previous, 'b'))
      previous = next
    }

    const result = collectPageWatchSources(new Set([pages]), () => false)
    expect(result.truncated).toBe(true)
    // roots 本身不占用链接来源预算
    expect(result.directories.size + result.files.size).toBeLessThanOrEqual(PAGE_WATCH_SOURCE_LIMIT + 1)
  })
})
