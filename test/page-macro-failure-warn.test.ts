import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PageContext } from '../packages/core/src'

/**
 * 宏求值失败的可见性回归：旧代码只写 debug.error（默认关闭的日志
 * 通道），页面悄悄退回默认配置，用户没有任何信号。修复后经过
 * ctx.logger.warn 报出来。
 */

describe('page macro evaluation failure surfaces a warning', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-macro-warn-'))
    const pagesDir = path.join(tmpDir, 'src', 'pages', 'index')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
      path.join(pagesDir, 'index.vue'),
      [
        '<script lang="ts" setup>',
        'definePage(() => { throw new Error(\'boom in definePage\') });',
        '</script>',
        '',
        '<template><div>home</div></template>',
        '',
      ].join('\n'),
      'utf-8',
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('warns through the logger and falls back to the default page config', async () => {
    const ctx = new PageContext({ dir: 'src/pages', dts: false }, tmpDir, 'h5')
    const warn = vi.fn()
    ctx.setLogger({ warn } as any)

    await ctx.updatePagesJSON()

    expect(warn).toHaveBeenCalled()
    const message = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(message).toContain('boom in definePage')
    // 一轮生成只尝试读取一次，重复的扫描阶段不再重试失败页面
    expect(warn.mock.calls.filter(call => String(call[0]).includes('boom in definePage'))).toHaveLength(1)

    // 页面仍然注册，只是退回默认配置
    const content = fs.readFileSync(path.join(tmpDir, 'src', 'pages.json'), 'utf-8')
    expect(content).toContain('pages/index/index')
  })

  it('读取失败在下一次扫描重新尝试并恢复', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-macro-retry-'))
    try {
      const pagesDir = path.join(dir, 'src', 'pages', 'index')
      fs.mkdirSync(pagesDir, { recursive: true })
      const file = path.join(pagesDir, 'index.vue')
      fs.writeFileSync(file, '<script setup>definePage(() => { throw new Error("boom on retry") })</script><template><view /></template>')

      const ctx = new PageContext({ dir: 'src/pages', dts: false }, dir, 'h5')
      const warnings: string[] = []
      ctx.setLogger({ warn: (message: string) => warnings.push(String(message)) } as any)

      await ctx.scanAndMerge()
      expect(warnings.filter(message => message.includes('boom on retry'))).toHaveLength(1)
      expect(ctx.pageMetaData.find(page => page.path === 'pages/index/index')?.style).toBeUndefined()

      // 修复后不需要文件事件，下一轮全量扫描也能重新读取
      fs.writeFileSync(file, '<script setup>definePage({ style: { navigationBarTitleText: "recovered" } })</script><template><view /></template>')
      await ctx.scanAndMerge()

      expect(ctx.pageMetaData.find(page => page.path === 'pages/index/index')?.style).toMatchObject({
        navigationBarTitleText: 'recovered',
      })
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
