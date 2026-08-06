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
            "navigationBarTitleText": "hello world: MP Alipay"
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
            "navigationBarTitleText": "test jsonc page"
          },
          "enablePullDownRefresh": false
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
