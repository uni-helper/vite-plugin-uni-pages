import type { CommentArray, CommentLineToken, CommentObject } from 'comment-json'
import type { InternalPages } from '../packages/core/src/types'
import { CommentArray as CommentArrayValue } from 'comment-json'
import { describe, expect, it } from 'vitest'
import { ensureHomePageFirst, removeStaleSubPackages } from '../packages/core/src/pages-json-structure'
import { lineComment } from '../packages/core/src/pages-json-tokens'

// comment-json 的注释挂在 Symbol.for('before:i') / ('after:i') 上，
// 类型声明里没有这个索引签名，测试里通过 any 访问
function setComments(items: CommentArray<CommentObject>, key: string, comments: CommentLineToken[]): void {
  const target = items as any
  target[Symbol.for(key)] = comments
}

function commentsAt(items: CommentArray<CommentObject>, key: string): CommentLineToken[] | undefined {
  return (items as any)[Symbol.for(key)] as CommentLineToken[] | undefined
}

describe('pages.json 结构操作', () => {
  it('把首页标记和 homePath 变体都移到最前，组内顺序稳定', () => {
    const pages: InternalPages = [
      { path: 'pages/list' },
      { path: 'pages/home', type: 'home' },
      { path: 'pages/detail' },
    ]

    ensureHomePageFirst(pages, 'pages/home')

    expect(pages.map(page => page.path)).toEqual(['pages/home', 'pages/list', 'pages/detail'])
  })

  it('手写条目没有 type 时按 homePath 匹配', () => {
    const pages: InternalPages = [
      { path: 'pages/list' },
      { path: 'pages/home' },
    ]

    ensureHomePageFirst(pages, 'pages/home')

    expect(pages.map(page => page.path)).toEqual(['pages/home', 'pages/list'])
  })

  it('删除过期子包时连同条目前的 #ifdef 注释一起移除', () => {
    const subPackages = new CommentArrayValue<CommentObject>()
    subPackages.push({ root: 'keep', pages: [] } as any)
    subPackages.push({ root: 'drop', pages: [] } as any)
    setComments(subPackages, 'before:0', [lineComment(' #ifdef H5')])
    setComments(subPackages, 'before:1', [lineComment(' #ifdef MP-WEIXIN')])
    setComments(subPackages, 'after:1', [lineComment(' #endif')])

    removeStaleSubPackages(subPackages, ['drop'])

    expect(subPackages.map(subPackage => subPackage.root)).toEqual(['keep'])
    expect(commentsAt(subPackages, 'before:0')?.[0]?.value).toBe(' #ifdef H5')
    expect(commentsAt(subPackages, 'before:1')).toBeUndefined()
    expect(commentsAt(subPackages, 'after:1')).toBeUndefined()
  })
})
