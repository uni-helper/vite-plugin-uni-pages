import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

describe('generate tabBar', () => {
  beforeEach(() => {
    vi.stubEnv('UNI_PLATFORM', 'web')
  })

  it('tabBar items should not contain index field', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const tabBar = await ctx.resolveTabBar()

    expect(tabBar).toBeDefined()
    expect(tabBar?.list).toBeDefined()

    for (const item of tabBar?.list || []) {
      expect(item).not.toHaveProperty('index')
    }
  })

  it('tabBar items should be sorted by index', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const tabBar = await ctx.resolveTabBar()

    expect(tabBar).toBeDefined()
    expect(tabBar?.list).toBeDefined()

    const list = tabBar?.list || []
    expect(list.length).toBeGreaterThanOrEqual(2)

    const listItem = list.find(item => item.pagePath?.includes('tabbar-list'))
    const profileItem = list.find(item => item.pagePath?.includes('tabbar-profile'))

    expect(listItem).toBeDefined()
    expect(profileItem).toBeDefined()
    expect(listItem?.text).toBe('列表')
    expect(profileItem?.text).toBe('我的')

    const listIndex = list.indexOf(listItem!)
    const profileIndex = list.indexOf(profileItem!)
    expect(listIndex).toBeLessThan(profileIndex)
  })

  it('tabBar should merge with config-defined tabBar', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    ctx.pagesGlobConfig = {
      tabBar: {
        color: '#999999',
        selectedColor: '#1890ff',
        backgroundColor: '#ffffff',
        list: [
          {
            pagePath: 'playground/src/pages/tabbar-list',
            text: '列表(配置)',
            iconPath: 'static/config-list.png',
            selectedIconPath: 'static/config-list-active.png',
          },
        ],
      },
    }
    await ctx.mergePageMetaData()

    const tabBar = await ctx.resolveTabBar()

    expect(tabBar).toBeDefined()
    expect(tabBar?.color).toBe('#999999')
    expect(tabBar?.selectedColor).toBe('#1890ff')
    expect(tabBar?.backgroundColor).toBe('#ffffff')
    expect(tabBar?.list).toBeDefined()
    expect(tabBar?.list!.length).toBeGreaterThanOrEqual(2)

    const configItem = tabBar?.list?.find(item => item.pagePath?.includes('tabbar-list') && item.text === '列表(配置)')
    expect(configItem).toBeDefined()
    expect(configItem?.iconPath).toBe('static/config-list.png')

    const profileItem = tabBar?.list?.find(item => item.pagePath?.includes('tabbar-profile'))
    expect(profileItem).toBeDefined()
    expect(profileItem?.text).toBe('我的')
  })

  it('tabBar should return undefined when no tabBar items exist', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages/blog' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const tabBar = await ctx.resolveTabBar()

    expect(tabBar).toBeUndefined()
  })

  it('tabBar items without index should default to index 0', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const noIndexPage = Array.from(ctx.pages.values()).find(p => p.path.relativePath.includes('tabbar-no-index'))
    expect(noIndexPage).toBeDefined()
    const tabBar = await noIndexPage!.getTabBar()
    expect(tabBar).toBeDefined()
    expect(tabBar!.index).toBe(0)
  })

  it('tabBar items with index: 0 should remain 0', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const zeroIndexPage = Array.from(ctx.pages.values()).find(p => p.path.relativePath.includes('tabbar-index-zero'))
    expect(zeroIndexPage).toBeDefined()
    const tabBar = await zeroIndexPage!.getTabBar()
    expect(tabBar).toBeDefined()
    expect(tabBar!.index).toBe(0)
  })
})
