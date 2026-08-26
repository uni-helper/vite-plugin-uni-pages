import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { checkPagesJsonFileSync, getPageFiles, resolveOptions } from '../packages/core/src'

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
        "define-page/conditional-define.vue",
        "define-page/function.vue",
        "define-page/nested-function.vue",
        "define-page/object.vue",
        "define-page/option-api.vue",
        "define-page/platform-injected.vue",
        "define-page/remove-console.vue",
        "define-page/skip-on-mp-weixin.vue",
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

describe('checkPagesJsonFileSync', () => {
  let tmpDir: string

  it('creates the placeholder when the file is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-check-'))
    const jsonPath = path.join(tmpDir, 'pages.json')

    checkPagesJsonFileSync(jsonPath)

    expect(fs.readFileSync(jsonPath, 'utf-8')).toContain('"pages"')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws on a read-only file and preserves its content', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-check-readonly-'))
    const jsonPath = path.join(tmpDir, 'pages.json')
    const original = '{\n  "pages": [{ "path": "pages/precious" }]\n}\n'
    fs.writeFileSync(jsonPath, original, 'utf-8')
    fs.chmodSync(jsonPath, 0o444)

    // 只读文件过去会被删除并用占位内容重建，手写内容静默丢失
    // （0444 文件在其所在目录可写时依然能被 unlink）
    expect(() => checkPagesJsonFileSync(jsonPath)).toThrow(/not readable and writable/)

    try {
      expect(fs.readFileSync(jsonPath, 'utf-8')).toBe(original)
    }
    finally {
      fs.chmodSync(jsonPath, 0o644)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws when the path is a directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-check-dir-'))
    const dirPath = path.join(tmpDir, 'pages.json')
    fs.mkdirSync(dirPath)

    try {
      expect(() => checkPagesJsonFileSync(dirPath)).toThrow(/not a regular file/)
    }
    finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
