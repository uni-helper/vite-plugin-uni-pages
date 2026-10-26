import type { SubPackage } from '@uni-helper/uni-pages-types'
import type { CommentArray, CommentObject, CommentSymbol, CommentToken } from 'comment-json'
import type { InternalPageItem, InternalPages } from './types'
import { debug } from './logger'
import { isGenerationMarker } from './platform-variants'

/**
 * 把所有首页条目移到最前面，注释跟着条目一起移动。
 *
 * 每个平台可以在自己的 #ifdef 块里声明自己的首页，没被包裹的条目
 * 所有平台都能看到。所以一个平台的首页必须排在它可见的所有条目
 * 之前：把所有首页放到所有非首页条目前面，组内顺序不变，一次满足
 * 所有平台。
 */
export function ensureHomePageFirst(pagesArray: InternalPages | undefined, homePath: string | undefined): void {
  if (!pagesArray || pagesArray.length === 0)
    return

  // 从 pages.json 合并而来的条目可能缺少内部 `type` 标记（手写条目
  // 从不携带它）。当 homePath 的任何变体都不带首页标记时，退回到按
  // 路径匹配。扫描出的条目总带标记，所以光靠 `type === 'home'` 就能
  // 收集到每个平台的首页变体
  const isHome = pagesArray.map((page: InternalPageItem) => page.type === 'home')
  if (homePath && !pagesArray.some((page: InternalPageItem) => page.path === homePath && page.type === 'home')) {
    // 首页路径的每个变体都要标记，不能只标第一个：各平台的变体在
    // 各自的 #ifdef 块里，只标第一个的话，其他平台的变体会一直卡在
    // 非首页条目后面，要等之后的写入才碰巧修复
    pagesArray.forEach((page: InternalPageItem, index: number) => {
      if (page.path === homePath)
        isHome[index] = true
    })
  }

  const homeCount = isHome.filter(Boolean).length
  if (homeCount === 0)
    return

  // 首页已经都在前面了：不用移动，保持输出字节不变
  if (isHome.slice(0, homeCount).every(Boolean))
    return

  const commentArray = pagesArray as unknown as CommentArray<CommentObject>
  const length = pagesArray.length

  // `CommentArray#splice` 移动元素时会"聪明地"重排注释，但它的规则
  // 会把注释挂到错误的条目上（#ifdef/#endif 块和生成标记错位）。
  // 所以先把每个条目的注释记下来、删掉符号，让重排像普通数组一样
  // 干净地执行，最后再把注释按新位置挂回去。
  const beforeTokens: Array<CommentToken[]> = []
  const afterTokens: Array<CommentToken[]> = []
  for (let i = 0; i < length; i++) {
    beforeTokens.push(commentArray[Symbol.for(`before:${i}`) as CommentSymbol] || [])
    afterTokens.push(commentArray[Symbol.for(`after:${i}`) as CommentSymbol] || [])
    Reflect.deleteProperty(commentArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(commentArray, Symbol.for(`after:${i}`) as CommentSymbol)
  }

  // before:0 里混着生成标记和第一个条目自己的注释（比如它的
  // #ifdef 块）：标记留在数组顶部，条目自己的注释跟着条目走
  const markerTokens = beforeTokens[0].filter(isGenerationMarker)
  beforeTokens[0] = beforeTokens[0].filter(token => !isGenerationMarker(token))

  // 稳定分区：首页在前、其余在后，两组内部都保持原来的相对顺序
  const order: number[] = []
  for (let i = 0; i < length; i++) {
    if (isHome[i])
      order.push(i)
  }
  for (let i = 0; i < length; i++) {
    if (!isHome[i])
      order.push(i)
  }
  pagesArray.splice(0, length, ...order.map(i => pagesArray[i]))

  for (let i = 0; i < length; i++) {
    const sourceIndex = order[i]
    const before = i === 0 ? [...markerTokens, ...beforeTokens[sourceIndex]] : beforeTokens[sourceIndex]
    if (before.length > 0)
      commentArray[Symbol.for(`before:${i}`) as CommentSymbol] = before
    if (afterTokens[sourceIndex].length > 0)
      commentArray[Symbol.for(`after:${i}`) as CommentSymbol] = afterTokens[sourceIndex]
  }
}

/**
 * 删除本轮扫描不到、但确实由插件生成的分包。
 *
 * 不删的话，这个 root 会以空分包进入本平台构建产物（app.json 里留
 * 一个指向不存在目录的 pages 数组）。手写分包没有生成标记，原样保留。
 *
 * 倒序遍历；删除条目注释符号再 splice，让 comment-json 把 `#ifdef`
 * 块和用户注释一起带走。`after-value:i`（条目的 `}` 和 `,` 之间的
 * 用户注释）也必须删掉：splice 只挪注释、不删注释。
 */
export function removeStaleSubPackages(subPackagesArray: CommentArray<CommentObject>, staleRoots: readonly string[]): void {
  for (let i = subPackagesArray.length - 1; i >= 0; i--) {
    const existing = subPackagesArray[i] as unknown as SubPackage
    if (!staleRoots.includes(existing.root))
      continue
    debug.subPages(`Removing converged sub-package root: ${existing.root}`)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`before:${i}`) as CommentSymbol)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`after:${i}`) as CommentSymbol)
    Reflect.deleteProperty(subPackagesArray, Symbol.for(`after-value:${i}`) as CommentSymbol)
    subPackagesArray.splice(i, 1)
  }
}
