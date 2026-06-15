import type { ModuleNode, ViteDevServer } from 'vite'
import type { PageMetaDatum } from './types'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import babelGenerator from '@babel/generator'
import Debug from 'debug'
import groupBy from 'lodash.groupby'
import * as ts from 'typescript'
import { FILE_EXTENSIONS, RESOLVED_MODULE_ID_VIRTUAL } from './constant'

/**
 * Invalidate virtual module to trigger HMR update
 * When page configuration changes, the virtual module needs to be invalidated to regenerate content
 *
 * @param server - Vite dev server instance
 */
export function invalidatePagesModule(server: ViteDevServer) {
  const { moduleGraph } = server
  const mods = moduleGraph.getModulesByFile(RESOLVED_MODULE_ID_VIRTUAL)
  if (mods) {
    const seen = new Set<ModuleNode>()
    mods.forEach((mod) => {
      moduleGraph.invalidateModule(mod, seen)
    })
  }
}

/**
 * Debug logging utility
 * Uses debug package for leveled log output
 * Enable via environment variable DEBUG=vite-plugin-uni-pages:*
 */
export const debug = {
  /** HMR related logs */
  hmr: Debug('vite-plugin-uni-pages:hmr'),
  /** Configuration options related logs */
  options: Debug('vite-plugin-uni-pages:options'),
  /** Main package page scanning logs */
  pages: Debug('vite-plugin-uni-pages:pages'),
  /** Sub-package page scanning logs */
  subPages: Debug('vite-plugin-uni-pages:subPages'),
  /** Error logs */
  error: Debug('vite-plugin-uni-pages:error'),
  /** Cache related logs */
  cache: Debug('vite-plugin-uni-pages:cache'),
  /** Declaration file generation logs */
  declaration: Debug('vite-plugin-uni-pages:declaration'),
  /** definePage macro parsing logs */
  definePage: Debug('vite-plugin-uni-pages:definePage'),
}

/**
 * Convert file extensions array to glob pattern
 * @param extensions - File extensions array
 * @returns Glob pattern string
 */
export function extsToGlob(extensions: string[]) {
  return extensions.length > 1 ? `{${extensions.join(',')}}` : (extensions[0] || '')
}

/**
 * Check if file is a target page file
 * Determine if the file extension is in the supported page file types list
 *
 * @param path - File path
 * @returns Whether it's a target file
 */
export function isTargetFile(path: string) {
  const ext = path.split('.').pop()
  return FILE_EXTENSIONS.includes(ext!)
}

/**
 * merge page meta data array by path and assign style
 * @param pageMetaData  page meta data array
 * TODO: support merge middleware
 */
export function mergePageMetaDataArray(pageMetaData: PageMetaDatum[]) {
  const pageMetaDataObj = groupBy(pageMetaData, 'path')
  const result: PageMetaDatum[] = []
  for (const path in pageMetaDataObj) {
    const _pageMetaData = pageMetaDataObj[path]
    const options = _pageMetaData[0]
    for (const page of _pageMetaData) {
      options.style = Object.assign(options.style ?? {}, page.style ?? {})
      Object.assign(options, page)
    }
    result.push(options)
  }
  return result
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
export async function parseCode(options: { imports: string[], code: string, filename: string }): Promise<any> {
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
    const result = (vmContext.exports as any).default || vmContext.exports

    // Return result
    return result
  }
  catch (error: any) {
    throw new Error(`EXEC SCRIPT FAIL IN ${filename}: ${error.message} \n\n${jsCode}\n\n`)
  }
}

/**
 * Async sleep function
 * @param ms - Sleep duration in milliseconds
 * @returns Promise object
 */
export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get default export of a module
 * Compatible with CommonJS and ES Module export styles
 *
 * @param expr - Module object
 * @returns Default export value
 */
function getDefaultExport<T = any>(expr: T): T {
  return (expr as any).default === undefined ? expr : (expr as any).default
}

/** Babel code generator for converting AST back to code */
export const babelGenerate = getDefaultExport(babelGenerator)

export function stripType<T extends Record<string, unknown>>(item: T): Omit<T, 'type'> {
  const { type, ...rest } = item
  return rest
}

/**
 * Remove the internal `type` marker (`'home'` / `'page'`) from every element of
 * a `CommentArray` *in place* and return the same array.
 *
 * Unlike `items.map(stripType)`, this preserves the `Symbol.for('before:N')` /
 * `Symbol.for('after:N')` comment slots that `comment-json` attaches to the
 * array, so multi-platform `#ifdef` / `#endif` conditional-compilation blocks
 * survive serialization into pages.json. `.map()` rebuilds the array and drops
 * those symbol-keyed comments.
 *
 * @param items - CommentArray (or plain array) of page/tabBar metadata
 * @returns The same array reference, with `type` removed from each element
 */
export function stripTypeInPlace<T extends Record<string, unknown>>(items: T[]): T[] {
  for (const item of items) {
    if (item && 'type' in item) {
      delete (item as Record<string, unknown>).type
    }
  }
  return items
}
