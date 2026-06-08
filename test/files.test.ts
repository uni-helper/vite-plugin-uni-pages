import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { getPageFiles, resolveOptions } from '../packages/core/src'

const options = resolveOptions({}, process.cwd())
const pages = 'playground/src/pages'

describe('get files', () => {
  it('pages', async () => {
    const files = getPageFiles(pages, options)
    expect(files.sort()).toMatchInlineSnapshot(`
      [
        "A-top.vue",
        "blog/index.vue",
        "blog/post.vue",
        "define-page/async-function.vue",
        "define-page/conditional-compilation.vue",
        "define-page/function.vue",
        "define-page/nested-function.vue",
        "define-page/object.vue",
        "define-page/option-api.vue",
        "define-page/remove-console.vue",
        "define-page/yaml.vue",
        "i18n.vue",
        "index.nvue",
        "index.vue",
        "pages-internal-sub/index.vue",
        "tabbar-index-zero.vue",
        "tabbar-list.vue",
        "tabbar-no-index.vue",
        "tabbar-profile.vue",
        "test-json.vue",
        "test-jsonc-with-comment.vue",
        "test-yaml.vue",
        "test.vue",
      ]
    `)
  })
})
