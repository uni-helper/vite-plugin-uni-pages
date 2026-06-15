import type { CommentObject } from 'comment-json'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as cjParse } from 'comment-json'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Regression coverage for the multi-terminal pages.json race.
 *
 * Scenario: two dev servers (e.g. dev:mp-weixin + dev:h5) write the same
 * pages.json. The H5 terminal previously wrote an `#ifdef H5` block. The
 * mp-weixin terminal must NOT clobber it — its `genratePagesJSON` reads the
 * existing file inside the lock and preserves other platforms' blocks.
 *
 * Note on the platform model: `process.env.UNI_PLATFORM` is captured at module
 * load time by `@uni-helper/uni-env` (imported by context.ts), so we set it on
 * `process.env` before dynamically importing PageContext. A single test file
 * can therefore only model one "current" platform; we model the mp-weixin
 * terminal as the current process and the H5 terminal's output as a pre-seeded
 * file (exactly what the real race looks like on disk).
 */

// Set BEFORE importing context.ts, which captures `platform` from uni-env.
process.env.UNI_PLATFORM = 'mp-weixin'

// Dynamic import so the env above is in place when the module loads.
const { PageContext } = await import('../packages/core/src')

describe('concurrent pages.json update preserves other platforms', () => {
  let tmpDir: string
  let srcDir: string
  let pagesJsonPath: string

  beforeAll(() => {
    // Build a minimal page tree under a temp root so updatePagesJSON writes
    // into the temp dir instead of the repository.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-concurrent-'))
    srcDir = path.join(tmpDir, 'src')
    const pagesDir = path.join(srcDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    // A page whose definePage resolves to the same metadata on every platform.
    // The merge therefore keeps a single (default, comment-less) entry for it.
    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      [
        '<script lang="ts" setup>',
        'definePage(() => ({ style: { navigationBarTitleText: \'home\' } }));',
        '</script>',
        '',
        '<template><div>home</div></template>',
        '',
      ].join('\n'),
      'utf-8',
    )

    pagesJsonPath = path.join(srcDir, 'pages.json')
  })

  beforeEach(() => {
    // Seed the file with an H5-only entry, as if the H5 terminal just wrote it.
    fs.writeFileSync(
      pagesJsonPath,
      [
        '{',
        '  "pages": [',
        '    // #ifdef H5',
        '    {',
        '      "path": "pages/index",',
        '      "style": {',
        '        "navigationBarTitleText": "home H5"',
        '      }',
        '    }',
        '    // #endif',
        '  ]',
        '}',
      ].join('\n'),
      'utf-8',
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps the seeded #ifdef H5 block while adding the current platform entry', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/index', dts: false },
      tmpDir,
    )
    await ctx.updatePagesJSON()

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')

    // The H5 block seeded by the "other terminal" must survive.
    expect(content).toContain('#ifdef H5')
    expect(content).toContain('#endif')
    expect(content).toContain('home H5')

    // The file must remain parseable as JSON-with-comments (no half-written
    // or corrupted output from the concurrent read-modify-write). cjParse
    // returns a CommentJSONValue; the root is always an object here.
    const parsed = cjParse(content) as CommentObject
    const pages = parsed.pages
    expect(Array.isArray(pages)).toBe(true)
    if (!Array.isArray(pages)) {
      return
    }
    const paths = pages
      .filter((p): p is CommentObject => typeof p === 'object' && p !== null)
      .map(p => p.path)
    expect(paths).toContain('pages/index')
  })

  it('serializes overlapping updates without corrupting the file', async () => {
    const ctx = new PageContext(
      { dir: 'src/pages', outDir: 'src', homePage: 'pages/index', dts: false },
      tmpDir,
    )

    // Fire two updates near-simultaneously, mimicking two terminals reacting
    // to the same file change. The lock must serialize them so the final file
    // is valid and still carries the other-platform block.
    await Promise.all([ctx.updatePagesJSON(), ctx.updatePagesJSON()])

    const content = fs.readFileSync(pagesJsonPath, 'utf-8')
    expect(() => cjParse(content)).not.toThrow()
    expect(content).toContain('#ifdef H5')
  })
})
