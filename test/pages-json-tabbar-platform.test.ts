import type { TabBar } from '../packages/core/src'
import { describe, expect, it } from 'vitest'
import { mergePagesJson } from '../packages/core/src'

const pages = [
  { path: 'pages/index/index', type: 'home' as const },
  { path: 'pages/list/list', type: 'page' as const },
]

const h5TabBar: TabBar = {
  color: '#999999',
  list: [
    { pagePath: 'pages/index/index', text: 'Home' },
    { pagePath: 'pages/list/list', text: 'List' },
  ],
}

describe('mergePagesJson tabBar convergence across platforms', () => {
  it('keeps the H5 tabBar when the mp-weixin run has no tabBar', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })
    expect(h5Content).toContain('tabBar')

    // mp-weixin 没有贡献 tabBar：区块必须幸存，且只对 H5 可见
    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: undefined,
    }, { platform: 'mp-weixin' })

    expect(wxContent).toContain('"tabBar"')
    expect(wxContent).toContain('#ifdef H5')
    expect(wxContent).toContain('pages/index/index')
    expect(wxContent).toContain('pages/list/list')
    expect(wxContent).toContain('#endif')

    // 收敛：mp-weixin 侧重跑后文件不变
    const wxRerun = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: undefined,
    }, { platform: 'mp-weixin' })
    expect(wxRerun).toBe(wxContent)
  })

  it('keeps tabBar look-and-feel properties of the owning platform', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: undefined,
    }, { platform: 'mp-weixin' })

    expect(wxContent).toContain('"color": "#999999"')
  })

  it('unwraps the tabBar again when the owning platform re-runs with one', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })
    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: undefined,
    }, { platform: 'mp-weixin' })

    // H5 带着自己的 tabBar 重跑：条目合并回来，属性仍只对 H5 可见
    // （mp-weixin 依然一个条目都不拥有）
    const h5Rerun = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    expect(h5Rerun).toContain('"tabBar"')
    expect(h5Rerun.match(/"pagePath": "pages\/index\/index"/g)).toHaveLength(1)
    // 仍只作用于 H5：mp-weixin 不拥有任何条目
    expect(h5Rerun).toContain('#ifdef H5')
  })

  it('deletes the tabBar when the only owning platform drops it', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    const h5Rerun = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: undefined,
    }, { platform: 'h5' })

    expect(h5Rerun).not.toContain('tabBar')
  })

  it('writes the tabBar unwrapped when every platform in the union owns entries', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    expect(wxContent).toContain('"tabBar"')
    expect(wxContent.match(/"pagePath": "pages\/index\/index"/g)).toHaveLength(1)
    // 没有 tabBar 属性级的包裹层：两个平台都拥有条目。内层 list 条目
    // 仅在内容分叉时才可能各自保持包裹
    expect(wxContent).not.toMatch(/#ifdef H5\n\s*"tabBar"/)
  })

  it('keeps the owning platform props when a run declares an empty tabBar list', () => {
    const wxContent = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    // 声明了但为空的 list 不贡献任何条目，因此也不得替换拥有平台的
    // 外观属性
    const h5EmptyList = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', list: [] },
    }, { platform: 'h5' })

    expect(h5EmptyList).toContain('"color": "#999999"')
    expect(h5EmptyList).not.toContain('#111111')
    // 微信的条目幸存，对 h5 运行保持隔离
    expect(h5EmptyList).toContain('#ifdef MP-WEIXIN')
  })

  it('tracks per-platform look-and-feel props instead of last-writer-wins', () => {
    // 多平台 tabBar 属性评审问题的回归：H5 声明 #111111，mp-weixin
    // 声明 #aaaaaa。两者都必须幸存，各自待在自己的 #ifdef 之后，
    // 而不是最后写入者覆盖另一个平台的颜色
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', selectedColor: '#222222', list: [{ pagePath: 'pages/index/index', text: 'H5' }] },
    }, { platform: 'h5' })

    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: { color: '#aaaaaa', list: [{ pagePath: 'pages/index/index', text: 'WX' }] },
    }, { platform: 'mp-weixin' })

    expect(wxContent).toContain('// #ifdef H5\n    "color": "#111111",')
    expect(wxContent).toContain('// #ifdef MP-WEIXIN\n    "color": "#aaaaaa",')
    expect(wxContent).toContain('"selectedColor": "#222222"')

    // 任一平台重跑都稳定：属性不震荡，每个平台保留自己的颜色
    const h5Rerun = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', selectedColor: '#222222', list: [{ pagePath: 'pages/index/index', text: 'H5' }] },
    }, { platform: 'h5' })
    expect(h5Rerun).toContain('// #ifdef H5\n    "color": "#111111",')
    expect(h5Rerun).toContain('// #ifdef MP-WEIXIN\n    "color": "#aaaaaa",')
    expect(mergePagesJson(h5Rerun, {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', selectedColor: '#222222', list: [{ pagePath: 'pages/index/index', text: 'H5' }] },
    }, { platform: 'h5' })).toBe(h5Rerun)
  })

  it('merges props that agree across platforms into a single unwrapped value', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    const wxContent = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    // 两个平台值相同：一个覆盖全集的未包裹属性
    expect(wxContent.match(/"color": "#999999"/g)).toHaveLength(1)
    expect(wxContent).not.toMatch(/#ifdef (H5|MP-WEIXIN)\n\s*"color"/)
  })

  it('converges away props the owning platform no longer declares', () => {
    const h5Content = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: { ...h5TabBar, midButton: { width: '50px', height: '50px' } },
    }, { platform: 'h5' })
    expect(h5Content).toContain('"midButton"')

    // H5 不再声明 midButton 重跑：该变体失去唯一的平台后被丢弃，
    // 而不是作为陈旧的 #ifdef H5 块残留
    const h5Rerun = mergePagesJson(h5Content, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })
    expect(h5Rerun).not.toContain('midButton')
  })

  it('preserves hand-written #ifndef tabBar props verbatim', () => {
    const existing = [
      '{',
      '  "pages": [',
      '    // GENERATED BY UNI-PAGES, PLATFORM: MP-WEIXIN',
      '    {',
      '      "path": "pages/index/index",',
      '      "type": "home"',
      '    }',
      '  ],',
      '  "tabBar": {',
      '    // #ifndef MP-ALIPAY',
      '    "color": "#333333",',
      '    // #endif',
      '    "list": [',
      '      {',
      '        "pagePath": "pages/index/index",',
      '        "text": "Tab"',
      '      }',
      '    ]',
      '  }',
      '}',
    ].join('\n')

    const merged = mergePagesJson(existing, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    // #ifndef 属性与扫描出的属性并存，且原样保留
    expect(merged).toContain('// #ifndef MP-ALIPAY')
    expect(merged).toContain('"color": "#333333",')
    expect(merged).toContain('"color": "#999999"')
  })
})
