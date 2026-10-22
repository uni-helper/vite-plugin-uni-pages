import type { PagesJsonData, TabBar } from '../packages/core/src'
import { describe, expect, it } from 'vitest'
import { mergePagesJson } from '../packages/core/src'

/**
 * tabBar 条目顺序的跨平台回归：
 * 此前 tabBar list 的输出顺序跟随磁盘上 pages.json 的旧顺序，配置里
 * 新增的条目一律追加到末尾——哪个平台先构建决定了文件长什么样，配
 * 置里的声明顺序（如某个平台在 tabBar 第二位新增了一个条目）会被丢
 * 掉。现在的规则：本次配置声明了全部既有条目时（配置是全量超集），
 * 按配置顺序输出；配置没覆盖全部条目时保持磁盘序，避免两端构建来
 * 回翻转。pages 数组不参与（由首页前置子系统接管），见
 * platform-variants.ts 规则 6 的说明。
 */

const pages = [
  { path: 'pages/index/index', type: 'home' as const },
  { path: 'pages/extra/index', type: 'page' as const },
  { path: 'pages/list/index', type: 'page' as const },
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

function merge(content: string, tabBar: TabBar, platform: string): string {
  return mergePagesJson(content, {
    pages,
    subPackages: [],
    tabBar,
  } as PagesJsonData, { platform })
}

function readTabOrder(content: string): string[] {
  return [...content.matchAll(/"pagePath": "([^"]+)"/g)].map(match => match[1])
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
    // extra 仍只属于平台 B
    expect(secondContent).toContain('#ifdef APP-PLUS')
  })

  it('keeps the disk order when a platform config does not cover all entries', () => {
    const firstContent = merge('', baseTabBar, 'h5')
    const secondContent = merge(firstContent, tabBarWithExtra, 'app-plus')

    // 平台 A 的配置里没有 extra，覆盖不了全部条目：保持磁盘序，不重排
    const rerun = merge(secondContent, baseTabBar, 'h5')
    expect(readTabOrder(rerun)).toEqual([
      'pages/index/index',
      'pages/extra/index',
      'pages/list/index',
      'pages/profile/index',
    ])

    // 平台 A 重跑收敛：文件不再变化
    const rerun2 = merge(rerun, baseTabBar, 'h5')
    expect(rerun2).toBe(rerun)
  })

  it('follows the latest full-coverage config when two configs declare different orders', () => {
    // 两个平台的配置都声明了全部条目、但顺序不同：各自构建都会把共
    // 享文件重排成自己的配置顺序——每次构建产物各自正确（各平台剥掉
    // 注释后的顺序就是它自己配置的顺序），共享文件由最后写入者定稿，
    // 与平台收敛行为一致
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

    // 平台 A 再构建：跟随它的顺序
    expect(readTabOrder(merge(secondContent, reorderedTabBar, 'h5'))).toEqual([
      'pages/index/index',
      'pages/profile/index',
      'pages/list/index',
    ])
  })
})
