import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import process from 'node:process'
import type { SFCDescriptor, SFCScriptBlock } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import * as t from '@babel/types'
import generate from '@babel/generator'
import JSON5 from 'json5'
import { parse as YAMLParser } from 'yaml'
import { normalizePath } from 'vite'
import traverse from '@babel/traverse'
import type { PageContext } from './context'
import { debug, parseSFC } from './utils'
import type { DefinePageOptions, PageMetaDatum, PagePath, RouteBlockLang } from './types'
import { DEFINE_PAGE } from './constant'
import { runProcess } from './child-process'

export class Page {
  ctx: PageContext

  file: PagePath

  private rawOptions: string = ''
  private options: PageMetaDatum | undefined

  constructor(ctx: PageContext, file: PagePath) {
    this.ctx = ctx
    this.file = file
  }

  async getOptions(forceUpdate = false) {
    if (forceUpdate || !this.options)
      await this.readOptions()

    return this.options!
  }

  async hasChanged() {
    const { hasChanged } = await this.readOptions()
    return hasChanged
  }

  async readOptions() {
    try {
      const { relativePath, absolutePath } = this.file

      // eslint-disable-next-line unused-imports/no-unused-vars
      const { path, ...others } = await readPageOptionsFromFile(absolutePath, this.ctx.options.routeBlockLang)
      this.options = {
        path: normalizePath(relativePath.replace(extname(relativePath), '')),
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
      throw new Error(`Read page options fail in ${this.file.relativePath}\n${err.message}`)
    }
  }
}

async function readPageOptionsFromFile(path: string, routeBlockLang: RouteBlockLang) {
  const content = readFileSync(path, 'utf-8')
  const sfc = await parseSFC(content)

  const macroOptions = await readPageOptionsFromMacro(path, sfc)
  if (macroOptions)
    return macroOptions

  const blockOptions = await readPageOptionsFromBlock(path, routeBlockLang, sfc)
  if (blockOptions)
    return blockOptions

  return {} as DefinePageOptions
}

async function readPageOptionsFromMacro(path: string, sfc?: SFCDescriptor) {
  if (!sfc) {
    const content = readFileSync(path, 'utf-8')
    sfc = await parseSFC(content)
  }

  const { macro, imports } = findMacroWithImports(sfc.scriptSetup)

  if (!macro)
    return

  if (sfc?.customBlocks.find(b => b.type === 'route'))
    throw new Error(`mixed ${DEFINE_PAGE}() and <route/> is not allowed`)

  const [arg] = macro.arguments as [t.Expression]

  if (!arg)
    return

  const options: DefinePageOptions = await runExpressionByTSX({ file: path, exp: arg, imports })

  return options
}

async function readPageOptionsFromBlock(path: string, routeBlockLang: RouteBlockLang, sfc?: SFCDescriptor) {
  if (!sfc) {
    const content = readFileSync(path, 'utf-8')
    sfc = await parseSFC(content)
  }

  const block = sfc.customBlocks.find(b => b.type === 'route')

  if (!block)
    return

  const lang = (block.lang ?? routeBlockLang) as RouteBlockLang

  debug.routeBlock(`use ${lang} parser`)

  let options = {} as PageMetaDatum

  if (['json5', 'jsonc', 'json'].includes(lang))
    options = JSON5.parse(block.content) as PageMetaDatum
  else if (['yaml', 'yml'].includes(lang))
    options = YAMLParser(block.content) as PageMetaDatum

  if (!options.type)
    options.type = (typeof block.attrs.type === 'string') && block.attrs.type.length ? block.attrs.type : 'page'

  return options
}

function findMacroWithImports(scriptSetup: SFCScriptBlock | null) {
  const empty = { imports: [], macro: undefined } as {
    imports: t.ImportDeclaration[]
    macro: t.CallExpression | undefined
  }

  if (!scriptSetup)
    return empty

  const parsed = babelParse(scriptSetup.content, scriptSetup.lang || 'js', {
    plugins: [['importAttributes', { deprecatedAssertSyntax: true }]],
  })

  const stmts = parsed.body

  const nodes = stmts
    .map((raw: t.Node) => {
      let node = raw
      if (raw.type === 'ExpressionStatement')
        node = raw.expression
      return isCallOf(node, DEFINE_PAGE) ? node : undefined
    })
    .filter((node): node is t.CallExpression => !!node)

  if (!nodes.length)
    return empty

  if (nodes.length > 1)
    throw new Error(`duplicate ${DEFINE_PAGE}() call`)

  const macro = nodes[0]

  const [arg] = macro.arguments

  if (arg && !t.isFunctionExpression(arg) && !t.isArrowFunctionExpression(arg) && !t.isObjectExpression(arg))
    throw new Error(`${DEFINE_PAGE}() only accept argument in function or object`)

  const imports = stmts
    .map((node: t.Node) => (node.type === 'ImportDeclaration') ? node : undefined)
    .filter((node): node is t.ImportDeclaration => !!node)

  return {
    imports,
    macro,
  }
}

export function findMacro(scriptSetup: SFCScriptBlock | null) {
  return findMacroWithImports(scriptSetup).macro
}

async function runExpressionByTSX(options: { file: string, exp: t.Expression, imports: t.ImportDeclaration[] }) {
  const {
    file,
    exp,
    imports,
  } = options

  const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')

  if (!existsSync(tsx))
    throw new Error(`[vite-plugin-uni-pages] "tsx" is required for function argument of definePage macro`)

  const ast = t.file(t.program([
    t.expressionStatement(exp),
  ]))

  // 删除代码里的 console
  traverse(ast, {
    CallExpression: (path, _parent) => {
      if (path.node.callee.type === 'MemberExpression' && (path.node.callee.object as any).name === 'console')
        path.remove()
    },
  })

  const code = generate(ast).code

  const cwd = dirname(file)

  let script = ''

  for (const imp of imports)
    script += `${generate(imp).code}\n`

  script += t.isFunctionExpression(exp) || t.isArrowFunctionExpression(exp)
    ? `let fn=${code}\nPromise.resolve(fn()).then(res => console.log(JSON.stringify(res)))`
    : `let obj=${code}\nconsole.log(JSON.stringify(obj))`

  const result = await runProcess(tsx, ['-e', script], { cwd })

  debug.definePage(`\nSCRIPT: \n${script}`)
  debug.definePage(`RESULT: \n${result}`)

  return JSON.parse(result)
}
