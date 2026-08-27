import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PageContext } from '../packages/core/src'
import { getDeclaration } from '../packages/core/src/declaration'

/**
 * tab 页的排除过滤回归：旧代码拿带引号和前导斜杠的字符串
 * （如 `"/pages/index/index"`）和裸的 page.path 比较，永远不相等，
 * tab 页从未被从 _LocationUrl（navigateTo/redirectTo 的 url 类型）
 * 里排除过。修复后 tab 页只出现在 SwitchTabOptions 里。
 */

describe('declaration excludes tab pages from _LocationUrl', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pages-decl-tabbar-'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps tab pages out of _LocationUrl and inside SwitchTabOptions', () => {
    const ctx = new PageContext({ dts: false }, tmpDir, 'h5')
    ctx.pageMetaData = [
      { path: 'pages/index/index', type: 'home' },
      { path: 'pages/list/list', type: 'page' },
    ]
    ctx.subPageMetaData = []
    ctx.pagesGlobConfig = {
      tabBar: {
        list: [
          { pagePath: 'pages/index/index', text: 'Home' },
          { pagePath: 'pages/list/list', text: 'List' },
        ],
      },
    }

    const code = getDeclaration(ctx)

    // 两个 tab 页都不该出现在 _LocationUrl 里
    const locationUrlBlock = code.slice(code.indexOf('type _LocationUrl'), code.indexOf('interface NavigateToOptions'))
    expect(locationUrlBlock).not.toContain('pages/index/index')
    expect(locationUrlBlock).not.toContain('pages/list/list')

    // SwitchTabOptions 里有这两个 tab 页
    const switchTabBlock = code.slice(code.indexOf('interface SwitchTabOptions'), code.indexOf('type ReLaunchOptions'))
    expect(switchTabBlock).toContain('"/pages/index/index"')
    expect(switchTabBlock).toContain('"/pages/list/list"')

    // 没有 tabBar 时不过滤任何页面
    ctx.pagesGlobConfig = {}
    const noTabBar = getDeclaration(ctx)
    const noTabBarLocation = noTabBar.slice(noTabBar.indexOf('type _LocationUrl'), noTabBar.indexOf('interface NavigateToOptions'))
    expect(noTabBarLocation).toContain('"/pages/index/index"')
    expect(noTabBarLocation).toContain('"/pages/list/list"')
  })

  it('also honors tabBar pages declared through definePage (ctx.tabBar)', () => {
    // 旧代码只看 pages.config.ts 的 tabBar，definePage 里声明的 tab 页
    // 不会进 SwitchTabOptions，也不会从 _LocationUrl 里排除。合并后的
    // tabBar（ctx.tabBar）才是完整名单
    const ctx = new PageContext({ dts: false }, tmpDir, 'h5')
    ctx.pageMetaData = [
      { path: 'pages/index/index', type: 'home' },
      { path: 'pages/list/list', type: 'page' },
    ]
    ctx.subPageMetaData = []
    ctx.pagesGlobConfig = {}
    ctx.tabBar = {
      list: [{ pagePath: 'pages/index/index', text: 'Home' }],
    }

    const code = getDeclaration(ctx)

    const locationUrlBlock = code.slice(code.indexOf('type _LocationUrl'), code.indexOf('interface NavigateToOptions'))
    expect(locationUrlBlock).not.toContain('pages/index/index')
    expect(locationUrlBlock).toContain('"/pages/list/list"')

    const switchTabBlock = code.slice(code.indexOf('interface SwitchTabOptions'), code.indexOf('type ReLaunchOptions'))
    expect(switchTabBlock).toContain('"/pages/index/index"')
  })

  it('falls back to string when there is not a single page', () => {
    // 全新项目（或所有页面都被 definePage(null) 退出）时没有任何路径
    // 字面量可列。修复前会生成 `type _LocationUrl = ;`——这不是合法的
    // TypeScript，tsc 直接在生成的 d.ts 上报语法错误
    const ctx = new PageContext({ dts: false }, tmpDir, 'h5')
    ctx.pageMetaData = []
    ctx.subPageMetaData = []
    ctx.pagesGlobConfig = {}

    const code = getDeclaration(ctx)
    const locationUrlBlock = code.slice(code.indexOf('type _LocationUrl'), code.indexOf('interface NavigateToOptions'))
    expect(locationUrlBlock).toContain('type _LocationUrl =\n  string;')
  })
})
