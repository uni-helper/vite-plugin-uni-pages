import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import type { Context } from './context'
import type { PagesJSON, PathSet, RouteBlockLang, UserPageMeta } from './types'
import fs from 'node:fs'
import { extname } from 'node:path'
import * as t from '@babel/types'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import { assign as cjAssign } from 'comment-json'
import { normalizePath } from 'vite'
import { getRouteBlock, getRouteSfcBlock } from './customBlock'
import { babelGenerate, debug, parseCode } from './utils'

export const PAGE_TYPE_KEY = Symbol.for('type')
export const TABBAR_INDEX_KEY = Symbol.for('index')

export class PageFile {
  ctx: Context

  path: PathSet
  uri: string

  changed: boolean = true

  private raw: string = ''
  private meta: UserPageMeta | undefined

  constructor(ctx: Context, path: PathSet) {
    this.ctx = ctx
    this.path = path
    this.uri = normalizePath(path.rel.replace(extname(path.rel), ''))
  }

  public async getPageMeta(forceUpdate = false): Promise<PagesJSON.Page> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { path, type, tabBar: _, ...others } = this.meta || {}

    return {
      path: path ?? this.uri,
      ...others,
      [PAGE_TYPE_KEY]: type, // 既标注了 page 的 类型，又避免序列化时会多个 key
    }
  }

  public async getTabBar(forceUpdate = false): Promise<PagesJSON.TabBarItem | undefined> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { tabBar } = this.meta!

    if (tabBar === undefined) {
      return undefined
    }

    return {
      ...tabBar,
      pagePath: tabBar.pagePath || this.uri,
      [TABBAR_INDEX_KEY]: tabBar.index || 0,
    }
  }

  public hasChanged() {
    return this.changed
  }

  public async read() {
    let meta: UserPageMeta
    try {
      meta = await this.readPageMetaFromFile()
    }
    catch (err: any) {
      debug.error(err)
      return // break if read fail
    }

    let raw = ''
    try {
      raw = JSON.stringify(meta)
    }
    catch {
      // ignore stringify error
    }

    this.changed = this.raw !== raw
    this.meta = meta
    this.raw = raw
  }

  private async readPageMetaFromFile(): Promise<UserPageMeta> {
    try {
      const content = await fs.promises.readFile(this.path.abs, { encoding: 'utf-8' })
      const sfc = parseSFC(content, { filename: this.path.abs })

      const meta = await tryPageMetaFromMacro(sfc)
      if (meta) {
        return meta
      }

      return tryPageMetaFromCustomBlock(sfc, this.ctx.options.routeBlockLang)
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.rel}\n${err.message}`)
    }
  }
}

export function parseSFC(code: string, options?: SFCParseOptions): SFCDescriptor {
  return (
    VueParser(code, {
      pad: 'space',
      ...options,
    }).descriptor
    // for @vue/compiler-sfc ^2.7
    || (VueParser as any)({
      source: code,
      ...options,
    })
  )
}

export async function tryPageMetaFromMacro(sfc: SFCDescriptor): Promise<UserPageMeta | undefined> {
  const sfcScript = sfc.scriptSetup || sfc.script

  if (!sfcScript) {
    return undefined
  }

  const ast = babelParse(sfcScript.content, sfcScript.lang || 'js', {
    plugins: [['importAttributes', { deprecatedAssertSyntax: true }]],
  })
  const macro = findMacro(ast.body, sfc.filename)
  if (macro) {
    const imports = findImports(ast.body).filter(imp => !!imp.specifiers.length).map(imp => babelGenerate(imp).code)

    const [macroOption] = macro.arguments
    const code = babelGenerate(macroOption).code

    const parsed = await parseCode({
      imports,
      code,
      filename: sfc.filename,
    })

    const res = typeof parsed === 'function'
      ? await Promise.resolve(parsed())
      : await Promise.resolve(parsed)

    return {
      type: 'page',
      ...res,
    }
  }
  return undefined
}

export async function tryPageMetaFromCustomBlock(sfc: SFCDescriptor, routeBlockLang: RouteBlockLang): Promise<UserPageMeta> {
  const block = getRouteSfcBlock(sfc)

  const routeBlock = getRouteBlock(sfc.filename, block, routeBlockLang)

  const pageMeta: UserPageMeta = {
    type: routeBlock?.attr.type ?? 'page',
  }

  if (routeBlock) {
    try {
      cjAssign(pageMeta, routeBlock.content)
    }
    catch {
      // ignore parse error
    }
  }

  return pageMeta
}

export function findMacro(stmts: t.Statement[], filename: string): t.CallExpression | undefined {
  let macro: t.CallExpression | undefined

  for (const stmt of stmts) {
    let node: t.Node = stmt
    if (stmt.type === 'ExpressionStatement')
      node = stmt.expression

    if (isCallOf(node, 'definePage')) {
      macro = node
      break
    }
  }

  if (!macro)
    return

  // 提取 macro function 内的第一个参数
  const [opt] = macro.arguments

  // 检查 macro 的参数是否正确
  if (opt && !t.isFunctionExpression(opt) && !t.isArrowFunctionExpression(opt) && !t.isObjectExpression(opt)) {
    debug.definePage(`definePage() 参数仅支持函数或对象：${filename}`)
    return
  }

  return macro
}

export function findImports(stmts: t.Statement[]): t.ImportDeclaration[] {
  const imports: t.ImportDeclaration[] = []
  for (const stmt of stmts) {
    if (t.isImportDeclaration(stmt)) {
      imports.push(stmt)
    }
  }
  return imports
}
