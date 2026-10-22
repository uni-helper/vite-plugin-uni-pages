import type { PlatformVariant } from '../packages/core/src/platform-variants'
import { describe, expect, it } from 'vitest'
import { orderVariantLists, platformsExcluding, sortVariants, upsertCurrentVariant } from '../packages/core/src/platform-variants'

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

  it('drops empty platform names from corrupted lists', () => {
    // 残缺的生成标记行（平台列表被手改删空）拆出空串
    expect(platformsExcluding('', 'MP-WEIXIN')).toEqual([])
    // 手写的尾巴多一个分隔符的指令也拆出空串
    expect(platformsExcluding('H5 ||', 'MP-WEIXIN')).toEqual(['H5'])
    // 空串混进列表同样丢掉，且不算"还有别的平台"
    expect(platformsExcluding('H5 || || MP-WEIXIN', 'MP-ALIPAY')).toEqual(['H5', 'MP-WEIXIN'])
  })
})

describe('orderVariantLists', () => {
  it('orders variant lists by the config order when the config declares every existing key', () => {
    const mergedMap = new Map<string, PlatformVariant<{ v: string }>[]>([
      ['a', [variant(['H5'], 'a', { v: 'a' })]],
      ['b', [variant(['H5'], 'b', { v: 'b' })]],
    ])

    // 配置把 b 声明在 a 前面：输出跟随配置顺序，而不是磁盘序
    expect(orderVariantLists(mergedMap, ['b', 'a']).map(list => list[0].payload)).toEqual([{ v: 'b' }, { v: 'a' }])
  })

  it('inserts a config-added key at its declared position', () => {
    const mergedMap = new Map<string, PlatformVariant<{ v: string }>[]>([
      ['a', [variant(['H5'], 'a', { v: 'a' })]],
      // b 是本次配置新增的条目：upsert 后它已带着自己的变体注册进 mergedMap
      ['b', [variant(['APP-PLUS'], 'b', { v: 'b' })]],
      ['c', [variant(['H5'], 'c', { v: 'c' })]],
    ])

    // 落在 a、c 之间，而不是追加到末尾
    expect(orderVariantLists(mergedMap, ['a', 'b', 'c']).map(list => list[0].payload)).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
  })

  it('keeps the map (disk) order when the config does not cover all existing keys', () => {
    const mergedMap = new Map<string, PlatformVariant<{ v: string }>[]>([
      ['a', [variant(['H5'], 'a', { v: 'a' })]],
      ['b', [variant(['MP-WEIXIN'], 'b', { v: 'b' })]],
      ['c', [variant(['H5'], 'c', { v: 'c' })]],
    ])

    // 配置只有 a、c（b 属于其它平台）：保持磁盘序，避免两端构建来回翻转
    expect(orderVariantLists(mergedMap, ['a', 'c']).map(list => list[0].payload)).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
  })

  it('returns an empty array for an empty map', () => {
    expect(orderVariantLists(new Map(), ['a'])).toEqual([])
  })

  it('keeps the disk order when reordering is disabled with null', () => {
    const mergedMap = new Map<string, PlatformVariant<{ v: string }>[]>([
      ['a', [variant(['H5'], 'a', { v: 'a' })]],
      ['b', [variant(['H5'], 'b', { v: 'b' })]],
    ])

    // pages 数组的调用方传 null：永不重排
    expect(orderVariantLists(mergedMap, null).map(list => list[0].payload)).toEqual([{ v: 'a' }, { v: 'b' }])
  })
})
