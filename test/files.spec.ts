import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { getPageFiles, resolveOptions } from '../packages/core/src'

const pages = 'packages/playground/src'

const options = resolveOptions({}, process.cwd())
describe('get all files', () => {
  it('pages', async () => {
    const files = getPageFiles(pages, options)
    expect(files.sort()).toMatchInlineSnapshot(`
[
  "App.vue",
  "components/Counter.vue",
  "pages-sub-pages/sub-activity/pages/about/index.vue",
  "pages-sub-pages/sub-activity/pages/home/index.vue",
  "pages-sub-pages/sub-main/pages/about/index.nvue",
  "pages-sub-pages/sub-main/pages/about/index.vue",
  "pages-sub-pages/sub-main/pages/home/index.vue",
  "pages-sub/about/components/comp.vue",
  "pages-sub/about/components/dir/nest-comp.vue",
  "pages-sub/about/index.vue",
  "pages-sub/about/your.vue",
  "pages-sub/components/comp.vue",
  "pages-sub/components/dir/nest-comp.vue",
  "pages-sub/index.vue",
  "pages-sub2/about/components/comp.vue",
  "pages-sub2/about/components/dir/nest-comp.vue",
  "pages-sub2/about/index.vue",
  "pages-sub2/about/your.vue",
  "pages-sub2/components/comp.vue",
  "pages-sub2/components/dir/nest-comp.vue",
  "pages-sub2/index.vue",
  "pages/A-top.vue",
  "pages/blog/components/comp.vue",
  "pages/blog/components/dir/nest-comp.vue",
  "pages/blog/index.vue",
  "pages/blog/post.vue",
  "pages/components/comp.vue",
  "pages/components/dir/nest-comp.vue",
  "pages/define-page/async-function.vue",
  "pages/define-page/conditional-compilation.vue",
  "pages/define-page/function.vue",
  "pages/define-page/nested-function.vue",
  "pages/define-page/object.vue",
  "pages/define-page/option-api.vue",
  "pages/define-page/remove-console.vue",
  "pages/define-page/yaml.vue",
  "pages/i18n.vue",
  "pages/index.nvue",
  "pages/index.vue",
  "pages/test-json.vue",
  "pages/test-jsonc-with-comment.vue",
  "pages/test-yaml.vue",
  "pages/test.vue",
]
    `)
  })
})

const options2 = resolveOptions({
  exclude: ['pages*/**/components/**/*.*'],
}, process.cwd())
describe('get all files except components', () => {
  it('pages2', async () => {
    const files = getPageFiles(pages, options2)
    expect(files.sort()).toMatchInlineSnapshot(`
[
  "App.vue",
  "components/Counter.vue",
  "pages-sub-pages/sub-activity/pages/about/index.vue",
  "pages-sub-pages/sub-activity/pages/home/index.vue",
  "pages-sub-pages/sub-main/pages/about/index.nvue",
  "pages-sub-pages/sub-main/pages/about/index.vue",
  "pages-sub-pages/sub-main/pages/home/index.vue",
  "pages-sub/about/index.vue",
  "pages-sub/about/your.vue",
  "pages-sub/index.vue",
  "pages-sub2/about/index.vue",
  "pages-sub2/about/your.vue",
  "pages-sub2/index.vue",
  "pages/A-top.vue",
  "pages/blog/index.vue",
  "pages/blog/post.vue",
  "pages/define-page/async-function.vue",
  "pages/define-page/conditional-compilation.vue",
  "pages/define-page/function.vue",
  "pages/define-page/nested-function.vue",
  "pages/define-page/object.vue",
  "pages/define-page/option-api.vue",
  "pages/define-page/remove-console.vue",
  "pages/define-page/yaml.vue",
  "pages/i18n.vue",
  "pages/index.nvue",
  "pages/index.vue",
  "pages/test-json.vue",
  "pages/test-jsonc-with-comment.vue",
  "pages/test-yaml.vue",
  "pages/test.vue",
]
    `)
  })
})

const options3 = resolveOptions({
  exclude: [
    // 排除所有pages 里面的 components 文件夹
    'pages*/**/components/**/*.*',
    // 不排除 pages-sub2/**/components
    '!pages-sub2/**/components/**/*.*',
  ],
}, process.cwd())

describe('get all files except components but not pages-sub2/**/components', () => {
  it('pages3', async () => {
    const files = getPageFiles(pages, options3)
    expect(files.sort()).toMatchInlineSnapshot(`
[
  "App.vue",
  "components/Counter.vue",
  "pages-sub-pages/sub-activity/pages/about/index.vue",
  "pages-sub-pages/sub-activity/pages/home/index.vue",
  "pages-sub-pages/sub-main/pages/about/index.nvue",
  "pages-sub-pages/sub-main/pages/about/index.vue",
  "pages-sub-pages/sub-main/pages/home/index.vue",
  "pages-sub/about/index.vue",
  "pages-sub/about/your.vue",
  "pages-sub/index.vue",
  "pages-sub2/about/components/comp.vue",
  "pages-sub2/about/components/dir/nest-comp.vue",
  "pages-sub2/about/index.vue",
  "pages-sub2/about/your.vue",
  "pages-sub2/components/comp.vue",
  "pages-sub2/components/dir/nest-comp.vue",
  "pages-sub2/index.vue",
  "pages/A-top.vue",
  "pages/blog/index.vue",
  "pages/blog/post.vue",
  "pages/define-page/async-function.vue",
  "pages/define-page/conditional-compilation.vue",
  "pages/define-page/function.vue",
  "pages/define-page/nested-function.vue",
  "pages/define-page/object.vue",
  "pages/define-page/option-api.vue",
  "pages/define-page/remove-console.vue",
  "pages/define-page/yaml.vue",
  "pages/i18n.vue",
  "pages/index.nvue",
  "pages/index.vue",
  "pages/test-json.vue",
  "pages/test-jsonc-with-comment.vue",
  "pages/test-yaml.vue",
  "pages/test.vue",
]
    `)
  })
})
