import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { normalizePath } from 'vite'
import { assign as cjAssign } from 'comment-json'
import * as t from '@babel/types'
import { babelParse, isCallOf } from 'ast-kit'
import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelGenerate, debug, execScript } from './utils'
import type { PageMetaDatum, PagePath, RouteBlockLang, UserPageMeta } from './types'
import type { PageContext } from './context'
import { getRouteBlock, getRouteSfcBlock } from './customBlock'

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

    let meta = await tryPageMetaFromMacro(sfc)
    if (meta) {
      return meta
    }

    if (sfc.scriptSetup) {
      // script setup 仅支持 macro 模式，不支持 route 自定义节点
      return {}
    }

    meta = await tryPageMetaFromCustomBlock(sfc, this.ctx.options.routeBlockLang)

    return meta || {}
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
    let script = ''
    const importScript = imports.join('')
    script += importScript
    script += `export default ${code}`

    const result = await execScript(script, sfc.filename)
    return result as UserPageMeta
  }
  return undefined
}

export async function tryPageMetaFromCustomBlock(sfc: SFCDescriptor, routeBlockLang: RouteBlockLang): Promise<UserPageMeta | undefined> {
  const block = getRouteSfcBlock(sfc)

  const routeBlock = getRouteBlock(sfc.filename, block, routeBlockLang)

  if (routeBlock) {
    const pageMeta: UserPageMeta = {
      type: routeBlock?.attr.type ?? 'page',
    }

    cjAssign(pageMeta, routeBlock.content)

    return pageMeta
  }

  return undefined
}

export function findMacro(stmts: t.Statement[], filename: string): t.CallExpression | undefined {
  const nodes = stmts
    .map((raw: t.Node) => {
      let node = raw
      if (raw.type === 'ExpressionStatement')
        node = raw.expression
      return isCallOf(node, 'definePage') ? node : undefined
    })
    .filter((node): node is t.CallExpression => !!node)

  if (!nodes.length)
    return

  if (nodes.length > 1)
    throw new Error(`duplicate definePage() call`)

  // 仅第支持一个 definePage
  const macro = nodes[0]

  // 提取 macro function 内的第一个参数
  const [opt] = macro.arguments

  // 检查 macro 的参数是否正确
  if (opt && !t.isFunctionExpression(opt) && !t.isArrowFunctionExpression(opt) && !t.isObjectExpression(opt)) {
    debug.definePage(`definePage() only accept argument in function or object: ${filename}`)
    return
  }

  return macro
}

export function findImports(stmts: t.Statement[]): t.ImportDeclaration[] {
  return stmts
    .map((node: t.Node) => (node.type === 'ImportDeclaration') ? node : undefined)
    .filter((node): node is t.ImportDeclaration => !!node)
}
