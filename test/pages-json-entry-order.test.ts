import type { PagesJsonData, TabBar } from '../packages/core/src'
import { describe, expect, it } from 'vitest'
import { mergePagesJson } from '../packages/core/src'

/**
 * tabBar 条目顺序的跨平台回归：
 * 此前 tabBar list 的输出顺序跟随磁盘上 pages.json 的旧顺序，配置里
 * 新增的条目一律追加到末尾——哪个平台先构建决定了文件长什么样，配
 * 置里的声明顺序（如某个平台在 tabBar 第二位新增了一个条目）会被丢
 * 掉。
 *
 * 现在的规则：配置覆盖全部既有条目时整个列表按配置顺序输出；没覆盖
 * 时只把本次新增的条目插到声明位置，既有条目保持磁盘序，避免两端构
 * 建来回翻转。pages 数组不参与（由首页前置子系统接管），见
 * platform-variants.ts 规则 6 的说明。
 */

const pages = [
  { path: 'pages/index/index', type: 'home' as const },
  { path: 'pages/extra/index', type: 'page' as const },
  { path: 'pages/list/index', type: 'page' as const },
  { path: 'pages/other/index', type: 'page' as const },
  { path: 'pages/profile/index', type: 'page' as const },
]

const baseTabBar: TabBar = {
  color: '#999999',
  list: [
    { pagePath: 'pages/index/index', text: 'Home' },
    { pagePath: 'pages/list/index', text: 'List' },
    { pagePath: 'pages/profile/index', text: 'Profile' },
  ],
}

// 另一个平台在第二位新增了一个条目
const tabBarWithExtra: TabBar = {
  color: '#999999',
  list: [
    { pagePath: 'pages/index/index', text: 'Home' },
    { pagePath: 'pages/extra/index', text: 'Extra' },
    { pagePath: 'pages/list/index', text: 'List' },
    { pagePath: 'pages/profile/index', text: 'Profile' },
  ],
}

/** 合并一次 pages.json：固定页面清单，只换 tabBar 与运行平台 */
function merge(content: string, tabBar: TabBar, platform: string): string {
  return mergePagesJson(content, {
    pages,
    subPackages: [],
    tabBar,
  } as PagesJsonData, { platform })
}

/** 读取文件里 tabBar 条目的原始顺序（不考虑平台包裹） */
function readTabOrder(content: string): string[] {
  return [...content.matchAll(/"pagePath": "([^"]+)"/g)].map(match => match[1])
}

/**
 * 读取某个平台条件编译后实际看到的 tabBar 顺序。
 *
 * `#ifdef` 块里的条目只有列出的平台看得见，没有包裹的条目所有平台都
 * 看得见；外层 tabBar 自己的 `#ifdef` 也参与判断，所以这里用栈处理
 * 嵌套条件。
 */
function visibleTabOrder(content: string, platform: string): string[] {
  const order: string[] = []
  const stack: boolean[] = []
  let visible = true

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    const ifdefMatch = trimmed.match(/^\/\/\s*#ifdef\s+(\S.*)$/)
    if (ifdefMatch) {
      stack.push(visible)
      visible = visible && ifdefMatch[1].split('||').map(p => p.trim()).includes(platform)
      continue
    }
    if (trimmed === '// #endif') {
      visible = stack.pop() ?? true
      continue
    }
    if (!visible)
      continue

    const pagePathMatch = trimmed.match(/"pagePath": "([^"]+)"/)
    if (pagePathMatch)
      order.push(pagePathMatch[1])
  }
  return order
}

/** 读取 pages 数组的条目顺序（tabBar 用的是 pagePath，不会误匹配） */
function readPageOrder(content: string): string[] {
  return [...content.matchAll(/"path": "([^"]+)"/g)].map(match => match[1])
}

describe('mergePagesJson entry ordering', () => {
  it('places a config-added tab at its declared position when the config covers all entries', () => {
    // 先只有平台 A 在跑：tabBar 还没有 extra
    const firstContent = merge('', baseTabBar, 'h5')
    expect(readTabOrder(firstContent)).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    // 平台 B 构建：配置带上了 extra（第二位），且是唯一覆盖全部条目的配置
    const secondContent = merge(firstContent, tabBarWithExtra, 'app-plus')

    // 按配置顺序输出，而不是追加到末尾
    expect(readTabOrder(secondContent)).toEqual([
      'pages/index/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    // 每个平台实际看到的顺序也正确：H5 看不到 extra
    expect(visibleTabOrder(secondContent, 'APP-PLUS')).toEqual([
      'pages/index/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    expect(visibleTabOrder(secondContent, 'H5')).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    // extra 仍只属于平台 B
    expect(secondContent).toContain('#ifdef APP-PLUS')
  })

  it('keeps the disk order when a partial config adds no tab', () => {
    const firstContent = merge('', baseTabBar, 'h5')
    const secondContent = merge(firstContent, tabBarWithExtra, 'app-plus')

    // 平台 A 的配置里没有 extra，覆盖不了全部条目：既有条目保持磁盘序
    const rerun = merge(secondContent, baseTabBar, 'h5')
    expect(readTabOrder(rerun)).toEqual([
      'pages/index/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    expect(visibleTabOrder(rerun, 'H5')).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    // 平台 A 重跑收敛：文件不再变化
    const rerun2 = merge(rerun, baseTabBar, 'h5')
    expect(rerun2).toBe(rerun)
  })

  it('places a new tab at its declared position even when another platform has an exclusive tab', () => {
    // APP-PLUS 有独占的 extra；H5 没有它，但在第二位新增了 other。
    // H5 的配置覆盖不了全部既有条目，仍然要把 other 放到声明位置
    const h5TabBar: TabBar = {
      color: '#999999',
      list: [
        { pagePath: 'pages/index/index', text: 'Home' },
        { pagePath: 'pages/other/index', text: 'Other' },
        { pagePath: 'pages/list/index', text: 'List' },
        { pagePath: 'pages/profile/index', text: 'Profile' },
      ],
    }

    const appContent = merge('', tabBarWithExtra, 'app-plus')
    const h5Content = merge(appContent, h5TabBar, 'h5')

    // 既有键（含 APP-PLUS 的 extra）保持磁盘序，新增的 other 插到
    // 声明里的前驱 index 之后，而不是垫底
    expect(readTabOrder(h5Content)).toEqual([
      'pages/index/index',
      'pages/other/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    // 两个平台各自看到的顺序都是自己配置的顺序
    expect(visibleTabOrder(h5Content, 'H5')).toEqual([
      'pages/index/index',
      'pages/other/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    expect(visibleTabOrder(h5Content, 'APP-PLUS')).toEqual([
      'pages/index/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    // 两个平台的重跑都不再改动文件
    expect(merge(h5Content, h5TabBar, 'h5')).toBe(h5Content)
    expect(merge(h5Content, tabBarWithExtra, 'app-plus')).toBe(h5Content)
  })

  it('does not reorder pages by config order and still keeps the home page first', () => {
    const initial = mergePagesJson('', {
      pages: [
        { path: 'pages/list/index', type: 'page' },
        { path: 'pages/profile/index', type: 'page' },
        { path: 'pages/index/index', type: 'home' },
      ],
      subPackages: [],
    }, { platform: 'h5' })
    // 首页被挪到最前，其余保持磁盘序
    expect(readPageOrder(initial)).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    const merged = mergePagesJson(initial, {
      pages: [
        { path: 'pages/profile/index', type: 'page' },
        { path: 'pages/list/index', type: 'page' },
        { path: 'pages/index/index', type: 'home' },
      ],
      subPackages: [],
    }, { platform: 'app-plus' })

    // pages 不参与配置序重排：配置里的逆序不生效，首页仍在前
    expect(readPageOrder(merged)).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])
  })

  it('lets the latest full-coverage config decide the shared order', () => {
    // 两个平台的配置都声明了全部条目、但顺序不同：各自运行都会把共
    // 享文件重排成自己的配置顺序，文件由最后写入者定稿。条目内容相
    // 同而合并成一条时没有按平台区分的副本，另一个正在运行的平台在
    // 下一次生成前也会读到对方顺序——并发开发时建议各平台保持一致
    // 的完整 tab 顺序（见 README 多终端并发开发）
    const reorderedTabBar: TabBar = {
      color: '#999999',
      list: [
        { pagePath: 'pages/index/index', text: 'Home' },
        { pagePath: 'pages/profile/index', text: 'Profile' },
        { pagePath: 'pages/list/index', text: 'List' },
      ],
    }

    const firstContent = merge('', reorderedTabBar, 'h5')
    expect(readTabOrder(firstContent)).toEqual([
      'pages/index/index',
      'pages/profile/index',
      'pages/list/index',
    ])

    // 平台 B 的配置顺序不同：文件跟随它
    const secondContent = merge(firstContent, baseTabBar, 'app-plus')
    expect(readTabOrder(secondContent)).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])
    // 条目已合并成共享条目：H5 在下一次生成前看到的也是平台 B 的顺序
    expect(visibleTabOrder(secondContent, 'H5')).toEqual([
      'pages/index/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    // 平台 A 再构建：跟随它的顺序
    const thirdContent = merge(secondContent, reorderedTabBar, 'h5')
    expect(readTabOrder(thirdContent)).toEqual([
      'pages/index/index',
      'pages/profile/index',
      'pages/list/index',
    ])
    expect(visibleTabOrder(thirdContent, 'APP-PLUS')).toEqual([
      'pages/index/index',
      'pages/profile/index',
      'pages/list/index',
    ])
  })
})
