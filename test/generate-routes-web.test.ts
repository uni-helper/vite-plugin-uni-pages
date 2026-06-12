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

  it('subPackages should preserve plugins property', async () => {
    const ctx = new PageContext({
      subPackages: [
        'playground/src/pages-sub-pages/sub-activity',
        'playground/src/pages-sub-pages/sub-main',
      ],
    })
    ctx.pagesGlobConfig = {
      subPackages: [
        {
          root: '../playground/src/pages-sub-pages/sub-activity',
          pages: [],
          plugins: {
            healthCardPlugins: {
              version: '1.0.0',
              provider: 'wx1234567890',
            },
          },
        },
      ],
    }
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()

    const parsed = JSON.parse(routes)
    const subActivity = parsed.find((p: any) => p.root === '../playground/src/pages-sub-pages/sub-activity')
    expect(subActivity).toBeDefined()
    expect(subActivity.plugins).toBeDefined()
    expect(subActivity.plugins.healthCardPlugins).toEqual({
      version: '1.0.0',
      provider: 'wx1234567890',
    })

    const subMain = parsed.find((p: any) => p.root === '../playground/src/pages-sub-pages/sub-main')
    expect(subMain).toBeDefined()
    expect(subMain.plugins).toBeUndefined()
  })

  it('subPackages with custom root (monorepo support)', async () => {
    const ctx = new PageContext({
      subPackages: [
        {
          dir: 'playground/src/pages-sub-pages/sub-activity',
          root: 'packages/activity/src/pages',
        },
        {
          dir: 'playground/src/pages-sub-pages/sub-main',
          root: 'packages/main/src/pages',
        },
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()
    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "root": "packages/activity/src/pages",
          "pages": [
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-activity/pages/about/index"
            },
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-activity/pages/home/index"
            }
          ]
        },
        {
          "root": "packages/main/src/pages",
          "pages": [
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-main/pages/about/index"
            },
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-main/pages/home/index"
            }
          ]
        }
      ]"
    `)
  })

  it('subPackages with mixed string and custom root formats', async () => {
    const ctx = new PageContext({
      subPackages: [
        'playground/src/pages-sub-pages/sub-activity',
        {
          dir: 'playground/src/pages-sub-pages/sub-main',
          root: 'packages/main/src/pages',
        },
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()
    const parsed = JSON.parse(routes)

    expect(parsed).toHaveLength(2)

    // String format uses computed relative path
    const subActivity = parsed.find((p: any) => p.root === '../playground/src/pages-sub-pages/sub-activity')
    expect(subActivity).toBeDefined()
    expect(subActivity.pages).toHaveLength(2)
    expect(subActivity.pages.map((p: any) => p.path)).toEqual(['pages/about/index', 'pages/home/index'])

    // Object format uses custom root
    const subMain = parsed.find((p: any) => p.root === 'packages/main/src/pages')
    expect(subMain).toBeDefined()
    expect(subMain.pages).toHaveLength(2)
  })

  it('subPackages with custom root should preserve plugins property', async () => {
    const ctx = new PageContext({
      subPackages: [
        {
          dir: 'playground/src/pages-sub-pages/sub-activity',
          root: 'packages/activity/src/pages',
        },
      ],
    })
    ctx.pagesGlobConfig = {
      subPackages: [
        {
          root: 'packages/activity/src/pages',
          pages: [],
          plugins: {
            testPlugin: {
              version: '2.0.0',
              provider: '',
            },
          },
        },
      ],
    }
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()
    const parsed = JSON.parse(routes)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].root).toBe('packages/activity/src/pages')
    expect(parsed[0].plugins).toBeDefined()
    expect(parsed[0].plugins.testPlugin).toEqual({ version: '2.0.0' })
  })
})
