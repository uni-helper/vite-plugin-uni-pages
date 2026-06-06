import type { UserPagesConfig } from '../packages/core/src'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

const pagesGlobConfig: UserPagesConfig = {
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: 'uni-helper',
    navigationBarBackgroundColor: '#F8F8F8',
    backgroundColor: '#F8F8F8',
  },
  pages: [
    {
      path: 'pages/index',
      style: {
        navigationBarTextStyle: 'black',
        navigationBarTitleText: 'uni-helper',
      },
      type: 'home',
    },
  ],
}

describe('generate routes', () => {
  beforeEach(() => {
    vi.stubEnv('UNI_PLATFORM', 'web')
  })

  it('vue - pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages', homePage: 'pages/index', subPackages: ['playground/src/pages/pages-internal-sub'] })
    await ctx.scanPages()
    await ctx.scanSubPages()
    await ctx.mergePageMetaData()

    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "path": "../playground/src/pages/index",
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../playground/src/pages/A-top"
        },
        {
          "path": "../playground/src/pages/blog/index"
        },
        {
          "path": "../playground/src/pages/blog/post"
        },
        {
          "path": "../playground/src/pages/define-page/async-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/conditional-compilation",
          "style": {
            "navigationBarTitleText": "hello world: H5"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/nested-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/object",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/option-api",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../playground/src/pages/define-page/remove-console",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../playground/src/pages/define-page/yaml",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        },
        {
          "path": "../playground/src/pages/i18n",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-index-zero",
          "style": {
            "navigationBarTitleText": "零索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-list",
          "style": {
            "navigationBarTitleText": "列表"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-no-index",
          "style": {
            "navigationBarTitleText": "无索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-profile",
          "style": {
            "navigationBarTitleText": "我的"
          }
        },
        {
          "path": "../playground/src/pages/test-json",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test-jsonc-with-comment",
          "style": {
            "navigationBarTitleText": "test jsonc page H5"
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../playground/src/pages/test-yaml",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        }
      ]"
    `)
  })

  it('vue - not merge pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages', mergePages: false, subPackages: ['playground/src/pages/pages-internal-sub'] })
    await ctx.scanPages()
    ctx.pagesGlobConfig = pagesGlobConfig
    await ctx.scanSubPages()
    await ctx.mergePageMetaData()
    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "path": "pages/index",
          "style": {
            "navigationBarTextStyle": "black",
            "navigationBarTitleText": "uni-helper"
          }
        },
        {
          "path": "../playground/src/pages/A-top",
          "style": {}
        },
        {
          "path": "../playground/src/pages/blog/index",
          "style": {}
        },
        {
          "path": "../playground/src/pages/blog/post",
          "style": {}
        },
        {
          "path": "../playground/src/pages/define-page/async-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/conditional-compilation",
          "style": {
            "navigationBarTitleText": "hello world: H5"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/nested-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/object",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/option-api",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../playground/src/pages/define-page/remove-console",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../playground/src/pages/define-page/yaml",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        },
        {
          "path": "../playground/src/pages/i18n",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../playground/src/pages/index",
          "style": {},
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../playground/src/pages/tabbar-index-zero",
          "style": {
            "navigationBarTitleText": "零索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-list",
          "style": {
            "navigationBarTitleText": "列表"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-no-index",
          "style": {
            "navigationBarTitleText": "无索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-profile",
          "style": {
            "navigationBarTitleText": "我的"
          }
        },
        {
          "path": "../playground/src/pages/test-json",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test-jsonc-with-comment",
          "style": {
            "navigationBarTitleText": "test jsonc page H5"
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../playground/src/pages/test-yaml",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        }
      ]"
    `)
  })

  it('fix subPackage cannot match the second-level dir', async () => {
    const ctx = new PageContext({
      subPackages: [
        'playground/src/pages-sub-pages/sub-activity',
        'playground/src/pages-sub-pages/sub-main',
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()
    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "root": "../playground/src/pages-sub-pages/sub-activity",
          "pages": [
            {
              "path": "pages/about/index"
            },
            {
              "path": "pages/home/index"
            }
          ]
        },
        {
          "root": "../playground/src/pages-sub-pages/sub-main",
          "pages": [
            {
              "path": "pages/about/index"
            },
            {
              "path": "pages/home/index"
            }
          ]
        }
      ]"
    `)
  })

  it('check pages is exist', async () => {
    const ctx = new PageContext({
      subPackages: [
        'playground/src/pages-sub-empty',
        'playground/src/pages-sub-pages/sub-main',
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "root": "../playground/src/pages-sub-pages/sub-main",
          "pages": [
            {
              "path": "pages/about/index"
            },
            {
              "path": "pages/home/index"
            }
          ]
        }
      ]"
    `)
  })
})

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
