import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterEach, expect, it, vi } from 'vitest'
import { writePagesJson } from '../packages/core/src/pages-json'

let root: string | undefined

afterEach(() => {
  vi.restoreAllMocks()
  if (root)
    fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function fixture(content?: string): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-read-'))
  const file = path.join(root, 'pages.json')
  if (content !== undefined)
    fs.writeFileSync(file, content)
  return file
}

it('keeps the existing pages.json when reading it fails', async () => {
  const original = '{\n  "pages": [\n    // #ifdef H5\n    { "path": "pages/legacy/index" }\n    // #endif\n  ]\n}'
  const file = fixture(original)
  // an editor or another process holding the file with an exclusive share
  vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EPERM' }))

  await expect(writePagesJson(
    file,
    { pages: [{ path: 'pages/index/index' }], subPackages: [] },
    { platform: 'mp-weixin' },
  )).rejects.toThrow('busy')

  expect(fs.readFileSync(file, 'utf-8')).toBe(original)
})

it('starts from an empty file when pages.json does not exist', async () => {
  const file = fixture()
  const result = await writePagesJson(
    file,
    { pages: [{ path: 'pages/index/index' }], subPackages: [] },
    { platform: 'mp-weixin' },
  )

  expect(result?.updated).toBe(true)
  const parsed = cjParse(fs.readFileSync(file, 'utf-8')) as unknown as { pages: { path: string }[] }
  expect(parsed.pages).toEqual([{ path: 'pages/index/index' }])
})
