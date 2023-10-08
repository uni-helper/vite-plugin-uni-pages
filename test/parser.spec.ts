import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { getRouteBlock, resolveOptions } from '../packages/core/src/index'

const options = resolveOptions({})
const pagesJson = 'packages/playground/src/pages/test-json.vue'
const pagesYaml = 'packages/playground/src/pages/test-yaml.vue'

describe('parser', () => {
  it('custom block', async () => {
    const path = resolve(pagesJson)
    const routeBlock = await getRouteBlock(path, options)
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
    const routeBlock = await getRouteBlock(path, options)
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
