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
          "type": "home",
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../playground/src/pages/A-top",
          "type": "page"
        },
        {
          "path": "../playground/src/pages/blog/index",
          "type": "page"
        },
        {
          "path": "../playground/src/pages/blog/post",
          "type": "page"
        },
        {
          "path": "../playground/src/pages/define-page/async-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/conditional-compilation",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world: H5"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/nested-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/object",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/option-api",
          "type": "page",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../playground/src/pages/define-page/remove-console",
          "type": "page",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../playground/src/pages/define-page/yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        },
        {
          "path": "../playground/src/pages/i18n",
          "type": "page",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-index-zero",
          "type": "page",
          "style": {
            "navigationBarTitleText": "零索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-list",
          "type": "page",
          "style": {
            "navigationBarTitleText": "列表"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-no-index",
          "type": "page",
          "style": {
            "navigationBarTitleText": "无索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-profile",
          "type": "page",
          "style": {
            "navigationBarTitleText": "我的"
          }
        },
        {
          "path": "../playground/src/pages/test-json",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test-jsonc-with-comment",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test jsonc page H5"
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../playground/src/pages/test-yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test",
          "type": "page",
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
          },
          "type": "home"
        },
        {
          "path": "../playground/src/pages/A-top",
          "type": "page",
          "style": {}
        },
        {
          "path": "../playground/src/pages/blog/index",
          "type": "page",
          "style": {}
        },
        {
          "path": "../playground/src/pages/blog/post",
          "type": "page",
          "style": {}
        },
        {
          "path": "../playground/src/pages/define-page/async-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/conditional-compilation",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world: H5"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/nested-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/object",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/define-page/option-api",
          "type": "page",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../playground/src/pages/define-page/remove-console",
          "type": "page",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../playground/src/pages/define-page/yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        },
        {
          "path": "../playground/src/pages/i18n",
          "type": "page",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../playground/src/pages/index",
          "type": "page",
          "style": {},
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../playground/src/pages/tabbar-index-zero",
          "type": "page",
          "style": {
            "navigationBarTitleText": "零索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-list",
          "type": "page",
          "style": {
            "navigationBarTitleText": "列表"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-no-index",
          "type": "page",
          "style": {
            "navigationBarTitleText": "无索引"
          }
        },
        {
          "path": "../playground/src/pages/tabbar-profile",
          "type": "page",
          "style": {
            "navigationBarTitleText": "我的"
          }
        },
        {
          "path": "../playground/src/pages/test-json",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test-jsonc-with-comment",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test jsonc page H5"
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../playground/src/pages/test-yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../playground/src/pages/test",
          "type": "page",
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
              "path": "pages/about/index",
              "type": "page"
            },
            {
              "path": "pages/home/index",
              "type": "page"
            }
          ]
        },
        {
          "root": "../playground/src/pages-sub-pages/sub-main",
          "pages": [
            {
              "path": "pages/about/index",
              "type": "page"
            },
            {
              "path": "pages/home/index",
              "type": "page"
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
              "path": "pages/about/index",
              "type": "page"
            },
            {
              "path": "pages/home/index",
              "type": "page"
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
              "path": "../../../../../playground/src/pages-sub-pages/sub-activity/pages/about/index",
              "type": "page"
            },
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-activity/pages/home/index",
              "type": "page"
            }
          ]
        },
        {
          "root": "packages/main/src/pages",
          "pages": [
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-main/pages/about/index",
              "type": "page"
            },
            {
              "path": "../../../../../playground/src/pages-sub-pages/sub-main/pages/home/index",
              "type": "page"
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
    expect(parsed[0].plugins.testPlugin).toEqual({ version: '2.0.0', provider: '' })
  })
})
