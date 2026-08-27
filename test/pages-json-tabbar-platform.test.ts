import type { PagesJsonData, TabBar } from '../packages/core/src'
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

    // mp-weixin 这次没带 tabBar：tabBar 区块要留下来，且只让 H5 看见
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

    // 再跑一遍 mp-weixin 侧：文件不变
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

    // H5 带着自己的 tabBar 重跑：条目合并回来，属性仍只让 H5 看见
    // （mp-weixin 还是一个条目都没有）
    const h5Rerun = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    expect(h5Rerun).toContain('"tabBar"')
    expect(h5Rerun.match(/"pagePath": "pages\/index\/index"/g)).toHaveLength(1)
    // 仍只作用于 H5：mp-weixin 没有任何条目
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
    // 没有 tabBar 属性级别的 #ifdef：两个平台都有条目。内层 list 条目
    // 只有内容各不相同时才可能各自包着
    expect(wxContent).not.toMatch(/#ifdef H5\n\s*"tabBar"/)
  })

  it('keeps the owning platform props when a run declares an empty tabBar list', () => {
    const wxContent = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    // 声明了 list 但它是空的：不算贡献任何条目，也不能拿自己的外观
    // 属性去顶掉 H5 的
    const h5EmptyList = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', list: [] },
    }, { platform: 'h5' })

    expect(h5EmptyList).toContain('"color": "#999999"')
    expect(h5EmptyList).not.toContain('#111111')
    // 微信的条目留了下来，h5 这边跑也碰不到它
    expect(h5EmptyList).toContain('#ifdef MP-WEIXIN')
  })

  it('tracks per-platform look-and-feel props instead of last-writer-wins', () => {
    // 多平台 tabBar 属性评审问题的回归：H5 写 #111111，mp-weixin 写
    // #aaaaaa。两个都得留，各自待在自己的 #ifdef 后面，不能最后写的
    // 把另一个平台的颜色顶掉
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

    // 任一平台重跑都稳定：属性不来回变，每个平台保住自己的颜色
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

    // H5 重跑时不再写 midButton：这个值失去唯一的平台后被丢弃，
    // 不会留成一个过期的 #ifdef H5 块
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

  it('wraps every prop of a multi-prop #ifndef block and closes it', () => {
    // 手写块一次包住两个属性的回归：旧代码只看每个属性自己紧挨着的
    // 注释，块里第二个属性（selectedColor）被当成无条件属性——平台
    // 全集里没有别的平台时直接消失，有别的平台时又会漏到所有平台面
    // 前。块的 #endif 则挂在第二个属性身上跟着一起被丢，第一个属性
    // 的 #ifndef 在输出里永远没有闭合符，后面的整个 tabBar 在被否定
    // 的平台上全部消失。修复后块里每个属性都带上完整的包裹
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
      '    "selectedColor": "#444444",',
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

    // 每个属性都有自己的开头指令和闭合符，输出不再有悬挂的 #ifndef
    expect(merged).toContain('// #ifndef MP-ALIPAY\n    "color": "#333333",\n    // #endif')
    expect(merged).toContain('// #ifndef MP-ALIPAY\n    "selectedColor": "#444444",\n    // #endif')
    // 本次运行的配置属性照常并存
    expect(merged).toContain('"color": "#999999"')

    // 重跑一遍字节不变
    expect(mergePagesJson(merged, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })).toBe(merged)
  })

  it('attributes every prop of a multi-prop #ifdef block to its platforms', () => {
    // #ifdef 多属性块的同类回归：第二个属性不再被误判成"没有条件"
    // 而丢掉或漏出去，块里每个属性都归属于注释里列出的平台
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
      '    // #ifdef H5',
      '    "color": "#333333",',
      '    "selectedColor": "#444444",',
      '    // #endif',
      '    "list": [',
      '      {',
      '        "pagePath": "pages/index/index"',
      '      }',
      '    ]',
      '  }',
      '}',
    ].join('\n')

    const merged = mergePagesJson(existing, {
      pages,
      subPackages: [],
      tabBar: { color: '#aaaaaa', list: [{ pagePath: 'pages/index/index', text: 'WX' }] },
    }, { platform: 'mp-weixin' })

    // 两个属性都归属于 H5：微信运行看不见它们，也不会顶掉微信自己
    // 的配置
    expect(merged).toContain('#ifdef H5\n    "color": "#333333",')
    expect(merged).toContain('#ifdef H5\n    "selectedColor": "#444444",')
    expect(merged).toContain('"color": "#aaaaaa"')

    expect(mergePagesJson(merged, {
      pages,
      subPackages: [],
      tabBar: { color: '#aaaaaa', list: [{ pagePath: 'pages/index/index', text: 'WX' }] },
    }, { platform: 'mp-weixin' })).toBe(merged)
  })

  it('keeps prop variant order byte-stable across alternating platform writes', () => {
    // 稳定性回归：属性变体按平台列表排序。修复前，当前平台的变体
    // 先被丢掉、再由本次运行补到列表末尾，两个平台轮流运行时同一个
    // 属性的变体顺序来回翻转，pages.json 每次写入都有一堆无意义的
    // 改动
    const h5Data: PagesJsonData = {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', list: [{ pagePath: 'pages/index/index', text: 'H5' }] },
    }
    const wxData: PagesJsonData = {
      pages,
      subPackages: [],
      tabBar: { color: '#aaaaaa', list: [{ pagePath: 'pages/index/index', text: 'WX' }] },
    }

    let content = mergePagesJson('', h5Data, { platform: 'h5' })
    content = mergePagesJson(content, wxData, { platform: 'mp-weixin' })
    const afterFirstRotation = content

    // 每一步都比，确保每次重跑都不改变文件；修复前偶数次翻转刚好
    // 转回原样，只看最后一步会漏掉中间的来回变
    for (const [platform, data] of [['h5', h5Data], ['mp-weixin', wxData], ['h5', h5Data], ['mp-weixin', wxData], ['h5', h5Data]] as const) {
      content = mergePagesJson(content, data, { platform })
      expect(content).toBe(afterFirstRotation)
    }
  })

  it('does not wrap tabBar in an empty #ifdef when only hand-written #ifndef entries remain', () => {
    // list 里只剩手写 #ifndef 条目、当前平台又没有 tabBar 时，
    // "拥有 tabBar 的平台"集合是空的。修复前会写出 `// #ifdef`（没有
    // 平台名的空指令），uni-app 的条件编译会因此把整个 tabBar 从
    // 所有平台上剥掉——包括 #ifndef 本来想留的那些平台
    const existing = [
      '{',
      '  "pages": [',
      '    // GENERATED BY UNI-PAGES, PLATFORM: MP-WEIXIN',
      '    { "path": "pages/index/index" }',
      '  ],',
      '  "tabBar": {',
      '    "color": "#fff",',
      '    "list": [',
      '      // #ifndef H5',
      '      { "pagePath": "pages/index/index", "text": "home" }',
      '      // #endif',
      '    ]',
      '  }',
      '}',
    ].join('\n')

    const content = mergePagesJson(existing, {
      pages,
      subPackages: [],
    }, { platform: 'h5' })

    // tabBar 保留，手写条目自己的 #ifndef 包裹原样，外层不再有
    // 没有平台名的空 #ifdef
    expect(content).toContain('"tabBar"')
    expect(content).toContain('#ifndef H5')
    expect(content).not.toMatch(/#ifdef\s*["'\n]/)

    // 重跑一遍字节不变
    expect(mergePagesJson(content, { pages, subPackages: [] }, { platform: 'h5' })).toBe(content)
  })

  it('emits a self-contained #ifndef wrap without stray #endif from the previous block', () => {
    // #ifndef 属性跟在 #ifdef 包裹的属性后面时，上家的 #endif 会挂在
    // 它的注释里一起透传出去。修复前输出形如
    //   // #ifndef X
    //   // #endif        <- 上家留下的，凭空多出一个空块
    //   // #ifndef X
    //   "custom": true,
    //   // #endif
    // 语义上侥幸配对，但极易误读；修复后每个属性只有自己的成对包裹
    const existing = [
      '{',
      '  "pages": [',
      '    // GENERATED BY UNI-PAGES, PLATFORM: H5 || MP-WEIXIN',
      '    { "path": "pages/index/index" }',
      '  ],',
      '  "tabBar": {',
      '    "color": "#fff",',
      '    // #ifdef H5',
      '    "selectedColor": "#000",',
      '    // #endif',
      '    // #ifndef MP-WEIXIN',
      '    "custom": true,',
      '    // #endif',
      '    "list": [',
      '      { "pagePath": "pages/index/index", "text": "home" }',
      '    ]',
      '  }',
      '}',
    ].join('\n')

    const content = mergePagesJson(existing, {
      pages,
      subPackages: [],
      tabBar: { color: '#fff', list: [{ pagePath: 'pages/index/index', text: 'home' }] },
    }, { platform: 'mp-alipay' })

    // custom 的包裹自成一对：紧邻属性，中间不夹别的指令
    expect(content).toContain('// #ifndef MP-WEIXIN\n    "custom": true,\n    // #endif')
    // 不再出现连续两条 #ifndef 指令（多出来的那条来自旧输出）
    expect(content).not.toMatch(/#ifndef[^\n]*\n\s*\/\/ #ifndef/)
    // 上家的 #ifdef 块照常保留
    expect(content).toContain('// #ifdef H5')

    // 重跑一遍字节不变
    expect(mergePagesJson(content, {
      pages,
      subPackages: [],
      tabBar: { color: '#fff', list: [{ pagePath: 'pages/index/index', text: 'home' }] },
    }, { platform: 'mp-alipay' })).toBe(content)
  })
})
