import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stringify as cjStringify } from 'comment-json'
import { describe, expect, it } from 'vitest'
import {
  getRouteBlock,
  getRouteSfcBlock,
  parseSFC,
  resolveOptions,
} from '../packages/core/src/index'

const options = resolveOptions({})
const pagesJson = 'packages/playground/src/pages/test-json.vue'
const pagesJsoncWithComment = 'packages/playground/src/pages/test-jsonc-with-comment.vue'
const pagesYaml = 'packages/playground/src/pages/test-yaml.vue'

describe('parser', () => {
  it('custom block', async () => {
    const path = resolve(pagesJson)
    const sfc = parseSFC(readFileSync(path, 'utf-8'), { filename: path })
    const str = await getRouteSfcBlock(sfc)
    const routeBlock = await getRouteBlock(path, str, options.routeBlockLang)
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
    const sfc = parseSFC(readFileSync(path, 'utf-8'), { filename: path })
    const str = await getRouteSfcBlock(sfc)
    const routeBlock = await getRouteBlock(path, str, options.routeBlockLang)
    expect(cjStringify(routeBlock, null, 2)).toMatchInlineSnapshot(`
      "{
        "attr": {
          "type": "page",
          "lang": "jsonc"
        },
        "content": {
          "style": {
            // #ifdef H5
            "navigationBarTitleText": "test jsonc page H5"
            // #endif
          },
          // #ifdef H5
          "enablePullDownRefresh": true
          // #endif
        }
      }"
    `)
  })

  it('yaml comment', async () => {
    const path = resolve(pagesYaml)
    const sfc = parseSFC(readFileSync(path, 'utf-8'), { filename: path })
    const str = await getRouteSfcBlock(sfc)
    const routeBlock = await getRouteBlock(path, str, options.routeBlockLang)
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
