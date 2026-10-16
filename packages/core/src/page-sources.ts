import type { Page } from './page'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'

/** 一轮扫描中已通过词法路径排除的页面来源 */
export interface PageSource {
  file: string
  identity: string
  dir: string
  root?: string
  explicitRoot: boolean
  ruleIndex: number
  matchIndex: number
  rootSource?: { dir: string, ruleIndex: number, explicitRoot: boolean }
}

/** 当前平台有效的页面及其完整生成路由 */
export interface PageCandidate extends PageSource {
  page: Page
  route: string
}

/** 仅为本轮存在的文件读取身份，删除或重命名中的文件不参与归属 */
export function resolvePageIdentity(file: string): string | undefined {
  try {
    return normalizePath(fs.realpathSync.native(file))
  }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error
  }
}

/** 显式来源优先，其余保持声明和 glob 匹配顺序 */
export function comparePageSources(a: Pick<PageSource, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>, b: Pick<PageSource, 'explicitRoot' | 'ruleIndex' | 'matchIndex'>): number {
  return Number(b.explicitRoot) - Number(a.explicitRoot)
    || a.ruleIndex - b.ruleIndex
    || a.matchIndex - b.matchIndex
}

function describeSource(source: PageSource): string {
  const declaration = source.root === undefined ? 'dir' : `subPackages[${source.ruleIndex}]`
  const owner = source.root === undefined ? 'main package' : `subpackage "${source.root}"`
  const rootSource = source.rootSource
  const rootOrigin = rootSource
    ? `, root from subPackages[${rootSource.ruleIndex}] "${rootSource.dir}" (${rootSource.explicitRoot ? 'explicit' : 'default'})`
    : ''
  return `"${source.file}" (${declaration}, directory "${source.dir}", ${owner}${rootOrigin})`
}

/** 按文件身份选择有效代表，分包优先于主包，不同分包不能认领同一页面 */
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
      throw new Error(`[vite-plugin-uni-pages] Conflicting subpackage ownership: ${describeSource(first)} and ${describeSource(conflict)} refer to the same page "${first.identity}".`)
    }
    selected.push([...(subPages.length ? subPages : group)].sort(comparePageSources)[0]!)
  }
  return selected
}

function fileFamily(source: PageCandidate, platform?: string): string {
  const extension = path.extname(source.identity)
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

/** 校验生成来源的完整路由，配置覆盖和输出去重在此之后执行 */
export function validateGeneratedRoutes(candidates: PageCandidate[], platform?: string): void {
  const routes = new Map<string, PageCandidate>()
  for (const candidate of candidates) {
    const route = path.posix.normalize(candidate.route.replace(/\\/g, '/')).replace(/\/$/, '')
    const previous = routes.get(route)
    if (previous && previous.identity !== candidate.identity) {
      const sameFamily = previous.root === candidate.root
        && fileFamily(previous, platform) === fileFamily(candidate, platform)
      if (!sameFamily) {
        throw new Error(`[vite-plugin-uni-pages] Conflicting generated route "${route}": ${describeSource(previous)} and ${describeSource(candidate)}.`)
      }
    }
    routes.set(route, candidate)
  }
}
