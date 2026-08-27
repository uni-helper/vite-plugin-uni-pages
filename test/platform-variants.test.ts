import type { PlatformVariant } from '../packages/core/src/platform-variants'
import { describe, expect, it } from 'vitest'
import { platformsExcluding, sortVariants, upsertCurrentVariant } from '../packages/core/src/platform-variants'

/**
 * 平台变体表核心规则的单测：这些规则此前只能通过 mergePagesJson 的
 * 字符串级回归间接覆盖（数组侧与 tabBar 属性侧各一套），现在在共享
 * 核心上直接锁定。
 */

function variant<P>(platforms: string[] | null, valueStr: string, payload: P): PlatformVariant<P> {
  return { payload, valueStr, platforms, platformStr: platforms === null ? '' : platforms.join(' || ') }
}

describe('upsertCurrentVariant', () => {
  it('stacks the current platform onto the same-value variant, sorted', () => {
    const variants = [variant(['MP-WEIXIN'], 'a', { v: 'a' })]

    upsertCurrentVariant(variants, { v: 'a' }, 'a', 'H5')

    expect(variants).toHaveLength(1)
    expect(variants[0].platforms).toEqual(['H5', 'MP-WEIXIN'])
    expect(variants[0].platformStr).toBe('H5 || MP-WEIXIN')
  })

  it('skips when a hand-written #ifndef variant already has the same value', () => {
    const variants = [variant(null, 'a', { v: 'a' })]

    upsertCurrentVariant(variants, { v: 'a' }, 'a', 'H5')

    expect(variants).toHaveLength(1)
    expect(variants[0].platforms).toBeNull()
  })

  it('creates a current-platform-only variant when no same-value variant exists', () => {
    const variants = [variant(['MP-WEIXIN'], 'a', { v: 'a' })]

    upsertCurrentVariant(variants, { v: 'b' }, 'b', 'H5')

    expect(variants).toHaveLength(2)
    expect(variants[1]).toMatchObject({ valueStr: 'b', platforms: ['H5'], platformStr: 'H5' })
  })

  it('keeps same-value variants apart when compatible rejects them', () => {
    // 数组侧的首页语义：内容相同但 type 标记冲突，是两个平台各自
    // 声明的不同首页，不能叠成一个变体
    interface PageLike { v: string, type?: string }
    const variants = [variant<PageLike>(['MP-WEIXIN'], 'a', { v: 'a', type: 'page' })]
    const byHomeStatus = (a: PageLike, b: PageLike) => (a.type ?? undefined) === (b.type ?? undefined)

    upsertCurrentVariant(variants, { v: 'a', type: 'home' }, 'a', 'H5', byHomeStatus)

    expect(variants).toHaveLength(2)
    expect(variants[1].platforms).toEqual(['H5'])
  })
})

describe('sortVariants', () => {
  it('sorts hand-written #ifndef first, then by platform string, stably', () => {
    const h5 = variant(['H5'], 'a', { v: 'a' })
    const wx = variant(['MP-WEIXIN'], 'b', { v: 'b' })
    const ifndef = variant(null, 'c', { v: 'c' })
    const h5Wx = variant(['H5', 'MP-WEIXIN'], 'd', { v: 'd' })

    const variants = [h5, wx, ifndef, h5Wx]
    sortVariants(variants)

    expect(variants).toEqual([ifndef, h5, h5Wx, wx])
  })
})

describe('platformsExcluding', () => {
  it('splits the platform list, drops the current platform, and sorts', () => {
    expect(platformsExcluding('H5 || MP-WEIXIN || MP-ALIPAY', 'MP-WEIXIN')).toEqual(['H5', 'MP-ALIPAY'])
  })
})
