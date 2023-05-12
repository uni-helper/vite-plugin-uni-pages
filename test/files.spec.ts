import { describe, expect, test } from 'vitest'
import { getPageFiles, resolveOptions } from '../packages/core/src'

const options = resolveOptions({}, process.cwd())
const pages = 'packages/playground/src/pages'

describe('Get files', () => {
  test('pages', async () => {
    const files = getPageFiles(pages, options)
    expect(files.sort()).toMatchInlineSnapshot(`
      [
        "A-top.vue",
        "blog/index.vue",
        "blog/post.vue",
        "index.vue",
        "test-json.vue",
        "test-yaml.vue",
        "test.vue",
      ]
    `)
  })
})
