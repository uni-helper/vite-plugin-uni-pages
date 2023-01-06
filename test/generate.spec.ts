import { describe, expect, test } from 'vitest'
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

describe('Generate routes', () => {
  test('vue - pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'packages/playground/src/pages' })
    await ctx.scanPages()
    await ctx.mergePageMetaData()
    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          \\"path\\": \\"../packages/playground/src/pages/index\\",
          \\"type\\": \\"page\\",
          \\"middlewares\\": [
            \\"auth\\",
            \\"test\\"
          ]
        },
        {
          \\"path\\": \\"../packages/playground/src/pages/test-json\\",
          \\"type\\": \\"page\\",
          \\"style\\": {
            \\"navigationBarTitleText\\": \\"test json page\\"
          },
          \\"middlewares\\": [
            \\"auth\\"
          ]
        },
        {
          \\"path\\": \\"../packages/playground/src/pages/test-yaml\\",
          \\"type\\": \\"page\\",
          \\"style\\": {
            \\"navigationBarTitleText\\": \\"test yaml page\\"
          },
          \\"middlewares\\": [
            \\"auth\\"
          ]
        },
        {
          \\"path\\": \\"../packages/playground/src/pages/blog/index\\",
          \\"type\\": \\"page\\"
        },
        {
          \\"path\\": \\"../packages/playground/src/pages/blog/post\\",
          \\"type\\": \\"page\\"
        }
      ]"
    `)
  })

  test('vue - not merge pages snapshot', async () => {
    const ctx = new PageContext({ dir: 'packages/playground/src/pages', mergePages: false })
    await ctx.scanPages()
    ctx.pagesGlobConfig = pagesGlobConfig
    await ctx.mergePageMetaData()
    const routes = ctx.resolveRoutes()

    expect(routes).toMatchInlineSnapshot(`
      "[
        {
          \\"path\\": \\"pages/index\\",
          \\"style\\": {
            \\"navigationBarTextStyle\\": \\"black\\",
            \\"navigationBarTitleText\\": \\"uni-helper\\"
          },
          \\"type\\": \\"home\\"
        }
      ]"
    `)
  })
})
