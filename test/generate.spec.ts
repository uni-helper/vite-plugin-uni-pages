import type { PagesJson, UserPagesJson } from '../packages/core/src'
import { describe, expect, it } from 'vitest'
import { Context } from '../packages/core/src'

const pagesGlobConfig: UserPagesJson = {
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
  it('vue - pages snapshot', async () => {
    const ctx = new Context({ dir: 'packages/playground/src/pages', homePage: 'pages/index' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()
    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "path": "../packages/playground/src/pages/A-top"
        },
        {
          "path": "../packages/playground/src/pages/i18n",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../packages/playground/src/pages/index",
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-json",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-jsonc-with-comment",
          "style": {
            // #ifdef H5
            "navigationBarTitleText": "test jsonc page H5"
            // #endif
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../packages/playground/src/pages/test-yaml",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/blog/index"
        },
        {
          "path": "../packages/playground/src/pages/blog/post"
        },
        {
          "path": "../packages/playground/src/pages/define-page/async-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/conditional-compilation",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/nested-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/object",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/option-api",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/remove-console",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/yaml",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        }
      ]"
    `)
  })

  it('vue - not merge pages snapshot', async () => {
    const ctx = new Context({ dir: 'packages/playground/src/pages', mergePages: false })
    await ctx.scanPages()
    ctx.pagesGlobConfig = pagesGlobConfig as PagesJson
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
          "path": "../packages/playground/src/pages/A-top",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/i18n",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../packages/playground/src/pages/index",
          "style": {},
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-json",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-jsonc-with-comment",
          "style": {
            // #ifdef H5
            "navigationBarTitleText": "test jsonc page H5"
            // #endif
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../packages/playground/src/pages/test-yaml",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/blog/index",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/blog/post",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/define-page/async-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/conditional-compilation",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/nested-function",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/object",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/option-api",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/remove-console",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/yaml",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        }
      ]"
    `)
  })

  it('fix subPackage cannot match the second-level dir', async () => {
    const ctx = new Context({
      subPackages: [
        'packages/playground/src/pages-sub-pages/sub-activity',
        'packages/playground/src/pages-sub-pages/sub-main',
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()
    expect(routes).toMatchInlineSnapshot(`
    "[
      {
        "root": "../packages/playground/src/pages-sub-pages/sub-activity",
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
        "root": "../packages/playground/src/pages-sub-pages/sub-main",
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
    const ctx = new Context({
      subPackages: [
        'packages/playground/src/pages-sub-empty',
        'packages/playground/src/pages-sub-pages/sub-main',
      ],
    })
    await ctx.scanSubPages()
    await ctx.mergeSubPageMetaData()
    const routes = ctx.resolveSubRoutes()

    expect(routes).toMatchInlineSnapshot(`
    "[
      {
        "root": "../packages/playground/src/pages-sub-pages/sub-main",
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
