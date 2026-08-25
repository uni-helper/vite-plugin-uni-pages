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

    // mp-weixin contributes no tabBar: the section must survive, scoped to H5
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

    // Convergence: re-running the mp-weixin pass leaves the file unchanged
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

    // H5 re-runs with its tabBar: entries merge back and the property stays
    // visible to H5 only (mp-weixin still owns none)
    const h5Rerun = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'h5' })

    expect(h5Rerun).toContain('"tabBar"')
    expect(h5Rerun.match(/"pagePath": "pages\/index\/index"/g)).toHaveLength(1)
    // Still scoped to H5: mp-weixin owns no entry
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
    // No tabBar-property-level wrapper: both platforms own the entries. Inner
    // list entries may stay individually wrapped for diverging content only
    expect(wxContent).not.toMatch(/#ifdef H5\n\s*"tabBar"/)
  })

  it('keeps the owning platform props when a run declares an empty tabBar list', () => {
    const wxContent = mergePagesJson('', {
      pages,
      subPackages: [],
      tabBar: h5TabBar,
    }, { platform: 'mp-weixin' })

    // A declared-but-empty list contributes no entries, so it must not
    // replace the owning platform's look-and-feel properties either
    const h5EmptyList = mergePagesJson(wxContent, {
      pages,
      subPackages: [],
      tabBar: { color: '#111111', list: [] },
    }, { platform: 'h5' })

    expect(h5EmptyList).toContain('"color": "#999999"')
    expect(h5EmptyList).not.toContain('#111111')
    // The wx entries survive, scoped away from the h5 run
    expect(h5EmptyList).toContain('#ifdef MP-WEIXIN')
  })
})
