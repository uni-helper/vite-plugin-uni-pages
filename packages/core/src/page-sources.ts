import type { Page } from './page'
import type { ScanSourceCoordinate } from './types'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'
import { FILE_EXTENSIONS } from './constant'
import { isMissingFsError } from './files'

/** 一轮扫描中已通过词法路径排除的页面来源 */
export interface PageSource extends ScanSourceCoordinate {
  /** 规范化的词法绝对路径，用于定位源文件 */
  file: string
  /** 规范化的 native realpath，仅用于身份和文件族判定，不作为输出路径 */
  identity: string
  /** 最终分包 root；undefined 表示主包 */
  root?: string
}

/** 当前平台有效的页面及其完整生成路由 */
export interface PageCandidate extends PageSource {
  page: Page
  /** 适用平台规则和路径换算后的完整路由，分包路由已包含 root */
  route: string
}

/** 完成归属决议的代表页面来源 */
export interface GeneratedPageSource extends PageCandidate {
  /** 同一物理页面的其他有效来源，不含代表，仅用于本轮冲突诊断 */
  relatedSources: PageSource[]
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
    if (!isMissingFsError(error))
      throw error
  }
}

/**
 * 比较页面来源的代表优先级
 *
 * @description 显式来源优先，其余按声明和 glob 匹配顺序；相同优先级返回 0
 */
export function comparePageSources(a: Pick<ScanSourceCoordinate, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>, b: Pick<ScanSourceCoordinate, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>): number {
  return Number(b.explicitRoot) - Number(a.explicitRoot)
    || a.ruleIndex - b.ruleIndex
    || a.matchIndex - b.matchIndex
}

function describeSource(source: PageCandidate): string {
  const declaration = source.root === undefined ? 'dir' : `subPackages[${source.ruleIndex}]`
  // 一条规则可能展开为多个目录，诊断中同时显示原始声明和实际匹配目录
  const rule = source.rulePattern === undefined ? '' : ` rule ${JSON.stringify(source.rulePattern)}`
  const owner = source.root === undefined ? 'main package' : `subpackage "${source.root}"`
  const rootSource = source.rootSource
  const rootOrigin = rootSource
    ? `, root from subPackages[${rootSource.ruleIndex}] "${rootSource.dir}" (${rootSource.explicitRoot ? 'explicit' : 'default'})`
    : ''
  return `"${source.file}" (${declaration}${rule}, directory "${source.dir}", ${owner}${rootOrigin})`
}

/** 关联记录仅保留来源信息，不携带其他 Page 实例 */
function toPageSource(candidate: PageCandidate): PageSource {
  return {
    file: candidate.file,
    identity: candidate.identity,
    dir: candidate.dir,
    root: candidate.root,
    explicitRoot: candidate.explicitRoot,
    ruleIndex: candidate.ruleIndex,
    matchIndex: candidate.matchIndex,
    rootSource: candidate.rootSource,
  }
}

function describeRelatedSource(source: PageSource): string {
  const owner = source.root === undefined ? 'main package' : `subpackage "${source.root}"`
  return `"${source.file}" (directory "${source.dir}", ${owner})`
}

function describeRelatedSources(source: GeneratedPageSource): string {
  if (source.relatedSources.length === 0)
    return ''
  return `; related sources: ${source.relatedSources.map(describeRelatedSource).join(', ')}`
}

/**
 * 为每个物理页面选择一个有效代表来源
 *
 * @description 候选需先通过文件排除，且未被宏结果或平台规则跳过；有效分包优先于主包，
 * 同一归属内按显式来源和声明顺序选择，返回顺序按文件身份首次出现的位置排列，
 * 同身份的其他来源仅保留在代表记录中，用于本轮冲突诊断
 * @param candidates - 本轮有效候选，数组不会被修改
 * @throws 同一物理页面被不同分包 root 认领时抛出来源冲突
 */
export function selectPageSources(candidates: PageCandidate[]): GeneratedPageSource[] {
  const groups = new Map<string, PageCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.identity) ?? []
    group.push(candidate)
    groups.set(candidate.identity, group)
  }
  const selected: GeneratedPageSource[] = []
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
    const pool = subPages.length ? subPages : group
    const representative = [...pool].sort(comparePageSources)[0]!
    const relatedSources = group.filter(source => source !== representative).map(toPageSource)
    selected.push({ ...representative, relatedSources })
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
export function validateGeneratedRoutes(candidates: GeneratedPageSource[], platform?: string): void {
  const routes = new Map<string, GeneratedPageSource>()
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
        throw new Error(`[vite-plugin-uni-pages] Conflicting generated route "${route}": ${describeSource(previous)}${describeRelatedSources(previous)} and ${describeSource(candidate)}${describeRelatedSources(candidate)}.`)
      }
    }
    routes.set(route, candidate)
  }
}
