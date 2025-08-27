import type { UserPagesConfig } from '../packages/core/src'
import { describe, expect, it } from 'vitest'
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
  it('vue - pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'packages/playground/src/pages', homePage: 'pages/index' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()
    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          "path": "../packages/playground/src/pages/A-top",
          "type": "page"
        },
        {
          "path": "../packages/playground/src/pages/i18n",
          "type": "page",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../packages/playground/src/pages/index",
          "type": "page",
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-json",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-jsonc-with-comment",
          "type": "page",
          "style": {
            // #ifdef H5
            "navigationBarTitleText": "test jsonc page H5"
            // #endif
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../packages/playground/src/pages/test-yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/blog/index",
          "type": "page"
        },
        {
          "path": "../packages/playground/src/pages/blog/post",
          "type": "page"
        },
        {
          "path": "../packages/playground/src/pages/define-page/async-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/conditional-compilation",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/nested-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/object",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ],
          "tabbar": {}
        },
        {
          "path": "../packages/playground/src/pages/define-page/option-api",
          "type": "page",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/remove-console",
          "type": "page",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        }
      ]"
    `)
  })

  it('vue - not merge pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'packages/playground/src/pages', mergePages: false })
    await ctx.scanPages()
    ctx.pagesGlobConfig = pagesGlobConfig
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
          "type": "page",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/i18n",
          "type": "page",
          "style": {
            "navigationBarTitleText": "%app.name%"
          }
        },
        {
          "path": "../packages/playground/src/pages/index",
          "type": "page",
          "style": {},
          "middlewares": [
            "auth",
            "test"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-json",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test json page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test-jsonc-with-comment",
          "type": "page",
          "style": {
            // #ifdef H5
            "navigationBarTitleText": "test jsonc page H5"
            // #endif
          },
          "enablePullDownRefresh": true
        },
        {
          "path": "../packages/playground/src/pages/test-yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test yaml page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/test",
          "type": "page",
          "style": {
            "navigationBarTitleText": "test page"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/blog/index",
          "type": "page",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/blog/post",
          "type": "page",
          "style": {}
        },
        {
          "path": "../packages/playground/src/pages/define-page/async-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/conditional-compilation",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/nested-function",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ]
        },
        {
          "path": "../packages/playground/src/pages/define-page/object",
          "type": "page",
          "style": {
            "navigationBarTitleText": "hello world"
          },
          "middlewares": [
            "auth"
          ],
          "tabbar": {}
        },
        {
          "path": "../packages/playground/src/pages/define-page/option-api",
          "type": "page",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/remove-console",
          "type": "page",
          "style": {
            "navigationBarTitleText": "this is a title"
          }
        },
        {
          "path": "../packages/playground/src/pages/define-page/yaml",
          "type": "page",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        }
      ]"
    `)
  })

  it('fix subPackage cannot match the second-level dir', async () => {
    const ctx = new PageContext({
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
        "root": "../packages/playground/src/pages-sub-pages/sub-main",
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
})
