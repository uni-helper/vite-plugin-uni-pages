import type { Page } from './page'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { FILE_EXTENSIONS } from './constant'

/** 一轮扫描中已通过词法路径排除的页面来源 */
export interface PageSource {
  /** 规范化的词法绝对路径，用于定位源文件 */
  file: string
  /** 规范化的 native realpath，仅用于身份和文件族判定，不作为输出路径 */
  identity: string
  /** 该文件来自的词法扫描目录 */
  dir: string
  /** 最终分包 root；undefined 表示主包 */
  root?: string
  /** 当前声明是否显式设置 root，不随同目录其他声明的 root 继承而改变 */
  explicitRoot: boolean
  /** 分包声明下标，从 0 开始；常规主包为 0，未关联声明的 hook 来源为 -1 */
  ruleIndex: number
  /** 声明内匹配目录的下标，从 0 开始，glob 按词法路径排序 */
  matchIndex: number
  /** 决定最终分包 root 的目录声明；主包没有此值 */
  rootSource?: { dir: string, ruleIndex: number, explicitRoot: boolean }
}

/** 当前平台有效的页面及其完整生成路由 */
export interface PageCandidate extends PageSource {
  page: Page
  /** 适用平台规则和路径换算后的完整路由，分包路由已包含 root */
  route: string
}

/**
 * 读取本轮页面文件的物理身份
 *
 * @returns 规范化的 native realpath；路径不存在或中间路径不是目录时为 undefined
 * @throws 权限不足等其他文件系统错误原样抛出
 */
export function resolvePageIdentity(file: string): string | undefined {
  try {
    return normalizePath(fs.realpathSync.native(file))
  }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error
  }
}

/**
 * 比较页面来源的代表优先级
 *
 * @description 显式来源优先，其余按声明和 glob 匹配顺序；相同优先级返回 0
 */
export function comparePageSources(a: Pick<PageSource, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>, b: Pick<PageSource, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>): number {
  return Number(b.explicitRoot) - Number(a.explicitRoot)
    || a.ruleIndex - b.ruleIndex
    || a.matchIndex - b.matchIndex
}

function describeSource(source: PageCandidate): string {
  const declaration = source.root === undefined ? 'dir' : `subPackages[${source.ruleIndex}]`
  // 一条规则可能展开为多个目录，诊断中同时显示原始声明和实际匹配目录
  const configured = source.root === undefined
    ? source.page.ctx.options.dir
    : source.page.ctx.options.subPackagePatterns[source.ruleIndex]
  const pattern = typeof configured === 'string' ? configured : configured?.dir
  const rule = pattern === undefined ? '' : ` rule ${JSON.stringify(pattern)}`
  const owner = source.root === undefined ? 'main package' : `subpackage "${source.root}"`
  const rootSource = source.rootSource
  const rootOrigin = rootSource
    ? `, root from subPackages[${rootSource.ruleIndex}] "${rootSource.dir}" (${rootSource.explicitRoot ? 'explicit' : 'default'})`
    : ''
  return `"${source.file}" (${declaration}${rule}, directory "${source.dir}", ${owner}${rootOrigin})`
}

/**
 * 为每个物理页面选择一个有效代表来源
 *
 * @description 候选需先通过文件排除，且未被宏结果或平台规则跳过；有效分包优先于主包，
 * 同一归属内按显式来源和声明顺序选择，返回顺序按文件身份首次出现的位置排列
 * @param candidates - 本轮有效候选，数组不会被修改
 * @throws 同一物理页面被不同分包 root 认领时抛出来源冲突
 */
export function selectPageSources(candidates: PageCandidate[]): PageCandidate[] {
  const groups = new Map<string, PageCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.identity) ?? []
    group.push(candidate)
    groups.set(candidate.identity, group)
  }
  const selected: PageCandidate[] = []
  for (const group of groups.values()) {
    const subPages = group.filter(source => source.root !== undefined)
    const first = subPages[0]
    const conflict = subPages.find(source => source.root !== first?.root)
    if (first && conflict) {
      const explanation = first.ruleIndex >= 0 && first.ruleIndex === conflict.ruleIndex && first.matchIndex !== conflict.matchIndex
        ? ' The same directory rule matched multiple directories containing this page. For one subpackage tree, declare its parent directory once; for multiple entries in the same subpackage, use a common root.'
        : ''
      throw new Error(`[vite-plugin-uni-pages] Conflicting subpackage ownership: ${describeSource(first)} and ${describeSource(conflict)} refer to the same page "${first.identity}".${explanation}`)
    }
    selected.push([...(subPages.length ? subPages : group)].sort(comparePageSources)[0]!)
  }
  return selected
}

/**
 * 获取允许格式或平台变体覆盖的物理文件族
 *
 * @description 格式变体共享去掉扩展名的真实路径；平台后缀只在主包且当前平台适用时处理
 * @returns 支持的真实页面格式对应的文件族，其他格式不参与覆盖例外
 */
function fileFamily(source: PageCandidate, platform?: string): string | undefined {
  const extension = path.extname(source.identity)
  // 文件别名可以指向其他格式或无扩展名文件，它们不能借别名获得格式覆盖例外
  if (!FILE_EXTENSIONS.includes(extension.slice(1)))
    return
  const stem = source.identity.slice(0, -extension.length)
  const filename = source.page.uri.slice(source.page.uri.lastIndexOf('/') + 1)
  // 平台资格使用词法文件 URI，宏里的 path 不能把普通文件伪装成变体
  if (platform === undefined || source.root !== undefined || !filename.includes('.') || !source.page.uri.includes(platform))
    return stem
  const slash = stem.lastIndexOf('/')
  const dot = stem.indexOf('.', slash + 1)
  // 文件别名可能改名，不能把别名的平台后缀套在另一种物理后缀上
  return dot !== -1 && stem.slice(dot) === filename.slice(filename.indexOf('.')) ? stem.slice(0, dot) : stem
}

/**
 * 校验生成页面是否占用同一完整路由
 *
 * @description 比较时规范化分隔符、点段和末尾斜杠，不改写候选或输出路径
 * @param candidates - 已完成物理身份归属决议的代表来源，需在配置覆盖和输出去重前传入
 * @param platform - 启用主包平台后缀规则时的当前平台，省略时只允许格式变体覆盖
 * @throws 不同生成来源占用同一路由且不属于同一归属的允许文件族时抛出冲突
 */
export function validateGeneratedRoutes(candidates: PageCandidate[], platform?: string): void {
  const routes = new Map<string, PageCandidate>()
  for (const candidate of candidates) {
    const route = path.posix.normalize(candidate.route.replace(/\\/g, '/')).replace(/\/$/, '')
    const previous = routes.get(route)
    if (previous && previous.identity !== candidate.identity) {
      // 文件族覆盖只在同一归属内成立，不能掩盖跨分包或主分包路由冲突
      const previousFamily = fileFamily(previous, platform)
      const sameFamily = previous.root === candidate.root
        && previousFamily !== undefined
        && previousFamily === fileFamily(candidate, platform)
      if (!sameFamily) {
        throw new Error(`[vite-plugin-uni-pages] Conflicting generated route "${route}": ${describeSource(previous)} and ${describeSource(candidate)}.`)
      }
    }
    routes.set(route, candidate)
  }
}
