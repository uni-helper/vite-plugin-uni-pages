import { describe, expect, it } from 'vitest'
import type { UserPagesConfig } from '../packages/core/src'
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
          "middlewares": [
            "auth",
            "test"
          ],
          "style": {}
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
})
