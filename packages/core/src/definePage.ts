import type { SFCDescriptor, SFCScriptBlock } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from '@vue-macros/common'
import * as t from '@babel/types'
import generate from '@babel/generator'
import { MACRO_DEFINE_PAGE } from './constant'
import type { PageMetaDatum } from './types'

function findMacroWithImports(scriptSetup: SFCScriptBlock | null) {
  try {
    const empty = { imports: [], macro: undefined }

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
        return isCallOf(node, MACRO_DEFINE_PAGE) ? node : undefined
      })
      .filter((node): node is t.CallExpression => !!node)

    if (!nodes.length)
      return empty

    if (nodes.length > 1)
      throw new Error(`duplicate ${MACRO_DEFINE_PAGE}() call`)

    const macro = nodes[0]

    const [arg] = macro.arguments

    if (arg && !t.isFunctionExpression(arg) && !t.isArrowFunctionExpression(arg) && !t.isObjectExpression(arg))
      throw new Error(`${MACRO_DEFINE_PAGE}() only accept argument in function or object`)

    const imports = stmts
      .map((node: t.Node) => (node.type === 'ImportDeclaration') ? node : undefined)
      .filter((node): node is t.ImportDeclaration => !!node)

    return {
      imports,
      macro,
    }
  } catch (error) {
    throw new Error(`Error parsing script setup content: ${error.message}`)
  }
}

export async function readPageOptionsFromMacro(sfc: SFCDescriptor) {
  const { macro } = findMacroWithImports(sfc.scriptSetup)

  if (!macro)
    return {}

  if (sfc?.customBlocks.find(b => b.type === 'route'))
    throw new Error(`mixed ${MACRO_DEFINE_PAGE}() and <route/> is not allowed`)

  const [arg] = macro.arguments

  if (!arg)
    return {}

  let code
  if (typeof generate === 'function') {
    code = generate(arg).code
  }
  else {
    code = (generate as any).default(arg).code
  }

  const script = t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg)
    ? `return await Promise.resolve((${code})())`
    : `return ${code}`

  const AsyncFunction = Object.getPrototypeOf(async () => { }).constructor

  const fn = new AsyncFunction(script)

  return await fn() as Partial<PageMetaDatum>
}

export function findMacro(scriptSetup: SFCScriptBlock | null) {
  return findMacroWithImports(scriptSetup).macro
}
