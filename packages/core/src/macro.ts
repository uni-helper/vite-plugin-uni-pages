import type { CallExpression } from '@babel/types'
import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import type { UserPageItem } from './types'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import babelGenerate from '@babel/generator'
import * as t from '@babel/types'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import * as ts from 'typescript'
import { debug } from './logger'

/**
 * definePage macro evaluation module
 *
 * Deep module hiding everything needed to understand a definePage macro:
 * SFC parsing, script block parsing with per-block failure isolation, macro
 * location, import collection and sandboxed evaluation. Callers only see two
 * functions: evaluateDefinePage (scan path) and findDefinePageMacro (transform
 * path).
 */

/**
 * Parse Vue Single File Component (SFC)
 * Compatible with different versions of @vue/compiler-sfc
 *
 * @param code - Vue SFC source code
 * @param options - Parse options
 * @returns SFC descriptor object
 */
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

/**
 * Evaluate the definePage macro of a Vue SFC and return the page metadata
 *
 * Used by the scan path. Parse and evaluation failures propagate so the
 * caller (Page.read) can degrade the page to path-only metadata.
 *
 * @param code - Vue SFC source code
 * @param filename - SFC filename, used for error location and module resolution
 * @returns Page metadata object, or undefined if definePage is not found
 */
export async function evaluateDefinePage(code: string, filename: string): Promise<UserPageItem | undefined> {
  const sfc = parseSFC(code, { filename })
  const sfcScript = sfc.scriptSetup || sfc.script

  if (!sfcScript) {
    return undefined
  }

  // Import attributes (`with { ... }`) are natively supported by @babel/parser 8.
  // The deprecated `assert { ... }` syntax has been removed upstream; such files
  // fail to parse here, the error propagates to Page.read() and the page
  // degrades to path-only metadata (the definePage macro cannot be evaluated).
  const ast = babelParse(sfcScript.content, sfcScript.lang || 'js')
  const macro = findMacro(ast.body, filename)
  if (!macro) {
    return undefined
  }

  const imports = findImports(ast.body).filter(imp => !!imp.specifiers.length).map(imp => babelGenerate(imp).code)

  const [macroOption] = macro.arguments
  const macroCode = babelGenerate(macroOption).code

  const parsed = await parseCode({
    imports,
    code: macroCode,
    filename,
  })

  const parsedMeta = typeof parsed === 'function' ? await parsed() : parsed

  return {
    type: 'page',
    ...parsedMeta,
  }
}

/**
 * Locate the definePage macro call in a Vue SFC without evaluating it
 *
 * Used by the transform path to remove the macro. Each script block is parsed
 * independently: a syntax error in one block (e.g. the deprecated
 * `assert { ... }` import attributes removed in @babel/parser 8) must not
 * skip macro removal in the other block. Failures are reported through
 * `onParseError` instead of throwing.
 *
 * @param code - Vue SFC source code
 * @param filename - SFC filename for error reporting
 * @param options - Optional hooks for per-block parse failures
 * @param options.onParseError - Called with the failing script block name and the error
 * @returns definePage call expression, or undefined if not found
 */
export function findDefinePageMacro(
  code: string,
  filename: string,
  options: { onParseError?: (block: string, error: unknown) => void } = {},
): CallExpression | undefined {
  const sfc = parseSFC(code, { filename })

  const tryFindMacro = (content: string, lang: string | undefined, block: string): CallExpression | undefined => {
    try {
      return findMacro(babelParse(content, lang || 'js').body, filename)
    }
    catch (error: unknown) {
      options.onParseError?.(block, error)
      return undefined
    }
  }

  if (sfc.scriptSetup) {
    const macro = tryFindMacro(sfc.scriptSetup.content, sfc.scriptSetup.lang, '<script setup>')
    if (macro)
      return macro
  }

  if (sfc.script) {
    const macro = tryFindMacro(sfc.script.content, sfc.script.lang, '<script>')
    if (macro)
      return macro
  }

  return undefined
}

/**
 * Find definePage macro call in AST
 * Support function expressions, arrow functions and object expressions as arguments
 *
 * @param stmts - AST statement array
 * @param filename - Filename for error reporting
 * @returns definePage call expression, or undefined if not found
 */
function findMacro(stmts: t.Statement[], filename: string): t.CallExpression | undefined {
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

  // Extract the first argument of the macro call
  const [opt] = macro.arguments

  // Validate the macro argument: only function or object literals are supported
  if (opt && !t.isFunctionExpression(opt) && !t.isArrowFunctionExpression(opt) && !t.isObjectExpression(opt)) {
    debug.definePage(`definePage() only supports a function or object literal as argument: ${filename}`)
    return
  }

  return macro
}

/**
 * Extract all import declarations from AST
 * Used to provide necessary imports when executing definePage arguments
 *
 * @param stmts - AST statement array
 * @returns Import declaration array
 */
function findImports(stmts: t.Statement[]): t.ImportDeclaration[] {
  return stmts.filter(t.isImportDeclaration)
}

/**
 * Convert TypeScript / JavaScript script code to object/function
 *
 * @param options - Configuration required for script execution
 * @param options.imports - List of module import statements to include
 * @param options.code - TypeScript code content to execute
 * @param options.filename - Script filename for error location and context
 * @returns Script execution result, if export is a function then execute and return its return value
 */
async function parseCode(options: { imports: string[], code: string, filename: string }): Promise<any> {
  const { imports = [], code, filename } = options

  let jsCode: string = ''
  try {
    const tmpCode = `${imports.join('\n')}\n export default ${code}`

    // Compile TypeScript code to JavaScript
    jsCode = ts.transpileModule(tmpCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, // Generated module format is CommonJS (Node.js default)
        target: ts.ScriptTarget.ES2022, // Target JavaScript version after compilation

        noEmit: true, // Don't generate output files
        strict: false, // Disable all strict type checking options
        noImplicitAny: false, // Allow expressions with any type
        strictNullChecks: false, // Disable strict null and undefined checks
        strictFunctionTypes: false, // Disable strict contravariant comparison of function parameters
        strictBindCallApply: false, // Disable strict type checking for bind, call and apply methods
        strictPropertyInitialization: false, // Disable strict checking of class property initialization
        noImplicitThis: false, // Allow this expressions to have implicit any type
        alwaysStrict: false, // Don't parse in strict mode or generate "use strict" directive for each source file

        allowJs: true, // Allow compiling JavaScript files
        checkJs: false, // Don't check types in JavaScript files
        skipLibCheck: true, // Skip type checking of TypeScript declaration files (*.d.ts)
        esModuleInterop: true, // Enable ES module interoperability, allow importing CommonJS modules with import
        removeComments: true, // Remove comments
      },
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone, // Don't parse JSDoc
    }).outputText

    const dir = path.dirname(filename)

    // Create a new VM context with dynamic import support
    const vmContext = {
      module: {},
      exports: {},
      __filename: filename,
      __dirname: dir,
      require: createRequire(dir),
      import: (id: string) => import(id),

      // Timer related
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      clearImmediate,

      // Console related
      console,

      // URL handling
      URL,
      URLSearchParams,

      // Process and performance related
      performance,

      // Global object references
      global: globalThis,
      globalThis,
    }

    // Execute JavaScript code using vm module
    const script = new vm.Script(jsCode, { filename })

    await script.runInNewContext(vmContext, {
      timeout: 1000, // Set timeout to avoid long-running scripts
    })

    // Get exported value
    return (vmContext.exports as any).default || vmContext.exports
  }
  catch (error: any) {
    throw new Error(`EXEC SCRIPT FAIL IN ${filename}: ${error.message} \n\n${jsCode}\n\n`)
  }
}
