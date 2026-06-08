import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

describe('generate routes - mp-alipay platform', () => {
  beforeEach(() => {
    vi.stubEnv('UNI_PLATFORM', 'mp-alipay')
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
            "navigationBarTitleText": "hello world: MP Alipay"
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
            "navigationBarTitleText": "test jsonc page"
          },
          "enablePullDownRefresh": false
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

  it('conditional-compilation page should show mp-alipay specific title', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages/define-page' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const routes = JSON.parse(ctx.resolveRoutes())
    const conditionalPage = routes.find((r: any) => r.path.includes('conditional-compilation'))

    expect(conditionalPage).toBeDefined()
    expect(conditionalPage.style.navigationBarTitleText).toBe('hello world: MP Alipay')
  })

  it('test-jsonc-with-comment page should not have H5-specific content', async () => {
    const ctx = new PageContext({ dir: 'playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()

    const routes = JSON.parse(ctx.resolveRoutes())
    const jsoncPage = routes.find((r: any) => r.path.includes('test-jsonc-with-comment'))

    expect(jsoncPage).toBeDefined()
    expect(jsoncPage.style.navigationBarTitleText).toBe('test jsonc page')
    expect(jsoncPage.enablePullDownRefresh).toBeFalsy()
  })
})
