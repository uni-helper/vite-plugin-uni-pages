import { describe, expect, it } from 'vitest'
import { filterPlatformSuffixPages } from '../packages/core/src'

/**
 * filterPlatformSuffixPages 的纯函数回归：这些场景此前只能通过
 * uni-platform-dots.test.ts 搭临时目录跑完整管线覆盖。
 */

describe('filterPlatformSuffixPages', () => {
  const pages = [
    { path: 'pages/v1.2/detail', type: 'page' as const },
    { path: 'pages/index.mp-weixin', type: 'page' as const },
    { path: 'pages/plain', type: 'page' as const },
    { path: 'pages/tabbar.h5', type: 'home' as const },
  ]

  it('keeps dotted directory paths intact and drops other platforms\' suffixed pages', () => {
    const result = filterPlatformSuffixPages(pages, 'h5')

    // 目录里的点不算后缀：路径原样保留，不被截成 pages/v1
    expect(result).toContainEqual(expect.objectContaining({ path: 'pages/v1.2/detail' }))
    // 别的平台的后缀文件被丢弃
    expect(result.some(page => page.path.startsWith('pages/index'))).toBe(false)
    // 普通页面保留
    expect(result).toContainEqual(expect.objectContaining({ path: 'pages/plain' }))
  })

  it('strips the current platform suffix from kept pages without mutating the input', () => {
    const input = [{ path: 'pages/tabbar.h5', type: 'home' as const }]
    const result = filterPlatformSuffixPages(input, 'h5')

    expect(result).toEqual([{ path: 'pages/tabbar', type: 'home' }])
    // 入参不被修改：纯函数
    expect(input[0].path).toBe('pages/tabbar.h5')
  })

  it('keeps suffixed pages only when the whole path mentions the current platform', () => {
    // 后缀匹配按整条 path 判断：目录里提到当前平台也算命中（历史行为）
    const result = filterPlatformSuffixPages([{ path: 'pages/h5/index.mp-weixin', type: 'page' as const }], 'h5')
    expect(result).toEqual([{ path: 'pages/h5/index', type: 'page' }])
  })
})
