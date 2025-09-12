import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import type { PageContext } from './context'
import type { PageMetaDatum, PagePath, RouteBlockLang, UserPageMeta } from './types'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import * as t from '@babel/types'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import { assign as cjAssign } from 'comment-json'
import { normalizePath } from 'vite'
import { getRouteBlock, getRouteSfcBlock } from './customBlock'
import { babelGenerate, debug, execScript } from './utils'

export class Page {
  ctx: PageContext

  path: PagePath

  private rawOptions: string = ''
  private options: PageMetaDatum | undefined

  constructor(ctx: PageContext, path: PagePath) {
    this.ctx = ctx
    this.path = path
  }

  public async getPageMeta(forceUpdate = false) {
    if (forceUpdate || !this.options) {
      await this.readPageMeta()
    }
    return this.options!
  }

  public async hasChanged() {
    const { hasChanged } = await this.readPageMeta()
    return hasChanged
  }

  public async readPageMeta() {
    try {
      const { relativePath } = this.path

      const { path, ...others } = await this.readPageMetaFromFile()
      this.options = {
        path: path ?? normalizePath(relativePath.replace(extname(relativePath), '')),
        ...others,
      }

      const raw = (this.options ? JSON.stringify(this.options) : '')
      const hasChanged = this.rawOptions !== raw
      this.rawOptions = raw
      return {
        options: this.options,
        hasChanged,
      }
    }
    catch (err: any) {
      throw new Error(`Read page options fail in ${this.path.relativePath}\n${err.message}`)
    }
  }

  private async readPageMetaFromFile(): Promise<UserPageMeta> {
    const content = readFileSync(this.path.absolutePath, 'utf-8')
    const sfc = parseSFC(content, { filename: this.path.absolutePath })

    const meta = await tryPageMetaFromMacro(sfc)
    if (meta) {
      return meta
    }

    return tryPageMetaFromCustomBlock(sfc, this.ctx.options.routeBlockLang)
  }
}

export function parseSFC(code: string, options?: SFCParseOptions): SFCDescriptor {
  try {
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
  catch (error) {
    throw new Error(`[vite-plugin-uni-pages] Vue3's "@vue/compiler-sfc" is required. \nOriginal error: \n${error}`)
  }
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
    const imports = findImports(ast.body).map(imp => babelGenerate(imp).code)

    const [macroOption] = macro.arguments
    const code = babelGenerate(macroOption).code

    const result = await execScript({
      imports,
      code,
      filename: sfc.filename,
    })
    return {
      type: 'page',
      ...result,
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
    cjAssign(pageMeta, routeBlock.content)
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
  return stmts
    .map((node: t.Node) => (node.type === 'ImportDeclaration') ? node : undefined)
    .filter((node): node is t.ImportDeclaration => !!node)
}
