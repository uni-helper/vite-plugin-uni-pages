import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRouteBlock, resolveOptions, getRouteSfcBlock } from '../packages/core/src/index'

const options = resolveOptions({})
const pagesJson = 'packages/playground/src/pages/test-json.vue'
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
          "middlewares": [
            "auth",
          ],
          "style": {
            "navigationBarTitleText": "test json page",
          },
        },
      }
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
