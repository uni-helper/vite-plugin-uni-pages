import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stringify as cjStringify } from 'comment-json'
import {
  getRouteBlock,
  getRouteSfcBlock,
  resolveOptions,
} from '../packages/core/src/index'

const options = resolveOptions({})
const pagesJson = 'packages/playground/src/pages/test-json.vue'
const pagesJsoncWithComment = 'packages/playground/src/pages/test-jsonc-with-comment.vue'
const pagesYaml = 'packages/playground/src/pages/test-yaml.vue'

describe('parser', () => {
  it('custom block', async () => {
    const path = resolve(pagesJson)
    const str = await getRouteSfcBlock(path)
    const routeBlock = await getRouteBlock(path, str, options)
    expect(routeBlock).toMatchInlineSnapshot(`
      {
        "attr": {
          "lang": "jsonc",
          "type": "page",
        },
        "content": {
          "middlewares": CommentArray [
            "auth",
          ],
          "style": {
            "navigationBarTitleText": "test json page",
          },
        },
      }
    `)
  })

  it('jsonc with comment', async () => {
    const path = resolve(pagesJsoncWithComment)
    const str = await getRouteSfcBlock(path)
    const routeBlock = await getRouteBlock(path, str, options)
    expect(cjStringify(routeBlock, null, 2)).toMatchInlineSnapshot(`
      "{
        "attr": {
          "type": "page",
          "lang": "jsonc"
        },
        "content": {
          "style": {
            // #ifdef APP
            "navigationBarTitleText": "test jsonc page APP"
            // #endif
          },
          // #ifdef APP
          "enablePullDownRefresh": true
          // #endif
        }
      }"
    `)
  })

  it('yaml comment', async () => {
    const path = resolve(pagesYaml)
    const str = await getRouteSfcBlock(path)
    const routeBlock = await getRouteBlock(path, str, options)
    expect(routeBlock).toMatchInlineSnapshot(`
      {
        "attr": {
          "lang": "yaml",
          "type": "page",
        },
        "content": {
          "middlewares": [
            "auth",
          ],
          "style": {
            "navigationBarTitleText": "test yaml page",
          },
        },
      }
    `)
  })
})
