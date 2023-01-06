import { resolve } from 'path'
import { describe, expect, test } from 'vitest'
import { getRouteBlock, resolveOptions } from '../packages/core/src/index'

const options = resolveOptions({})
const pagesJson = 'packages/playground/src/pages/test-json.vue'
const pagesYaml = 'packages/playground/src/pages/test-yaml.vue'

describe('Parser', () => {
  test('custom block', async () => {
    const path = resolve(pagesJson)
    const routeBlock = await getRouteBlock(path, options)
    expect(routeBlock).toMatchInlineSnapshot(`
      {
        "middlewares": [
          "auth",
        ],
        "style": {
          "navigationBarTitleText": "test json page",
        },
      }
    `)
  })

  test('yaml comment', async () => {
    const path = resolve(pagesYaml)
    const routeBlock = await getRouteBlock(path, options)
    expect(routeBlock).toMatchInlineSnapshot(`
      {
        "middlewares": [
          "auth",
        ],
        "style": {
          "navigationBarTitleText": "test yaml page",
        },
      }
    `)
  })
})
