import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { babelParse, isCallOf } from 'ast-kit'
import * as t from '@babel/types'
import { parse as parseJSON } from 'json5'
import { parse as parseYAML } from 'yaml'
import { normalizePath } from 'vite'
import type { SFCDescriptor } from '@vue/compiler-sfc'
import type { PageContext } from './context'
import type { PageMetaDatum, PagePath, UserPageMeta } from './types'
import { babelGenerate, debug, execScript, parseSFC } from './utils'

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
    const sfc = await parseSFC(content, { filename: this.path.absolutePath })

    const meta = await parseMacro(sfc)
    if (meta) {
      return meta
    }

    if (sfc.scriptSetup) {
      // script setup 仅支持 macro 模式，不支持 route 自定义节点
      return {}
    }

    const block = sfc.customBlocks.find(block => block.type === 'route')
    if (block) {
      const lang = block.lang ?? this.ctx.options.routeBlockLang

      debug.routeBlock(`use ${lang} parser`)

      let options = {} as UserPageMeta
      try {
        if (['json5', 'jsonc', 'json'].includes(lang)) {
          options = parseJSON(block.content)
        }
        else if (['yaml', 'yml'].includes(lang)) {
          options = parseYAML(block.content)
        }
        else {
          return {}
        }
      }
      catch (err: any) {
        debug.routeBlock(`Invalid ${lang.toUpperCase()} format of <${block.type}> content in ${this.path.relativePath}\n${err.message}`)
      }

      if (!options.type)
        options.type = (typeof block.attrs.type === 'string') && block.attrs.type.length ? block.attrs.type : 'page'

      return options
    }

    return {}
  }
}

export async function parseMacro(sfc: SFCDescriptor): Promise<UserPageMeta | undefined> {
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
