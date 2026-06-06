import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import type { TabBarItem } from './config'
import type { PageContext } from './context'
import type { PageMetaDatum, PagePath, UserPageMeta } from './types'
import fs from 'node:fs'
import { extname } from 'node:path'
import * as t from '@babel/types'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import { normalizePath } from 'vite'
import { babelGenerate, debug, parseCode } from './utils'

/**
 * Page class representing a Vue page file
 *
 * Responsibilities:
 * 1. Read page file content
 * 2. Parse page metadata defined by definePage macro
 * 3. Provide tabBar configuration information
 * 4. Track page file change status
 */
export class Page {
  /** Page context instance */
  ctx: PageContext

  /** Page path information containing relative and absolute paths */
  path: PagePath
  /** Page URI used for pages.json path field */
  uri: string

  /** Whether the page has changed, used for incremental update judgment */
  changed: boolean = true

  /** Raw JSON string of page metadata for change detection */
  private raw: string = ''
  /** Parsed page metadata */
  private meta: UserPageMeta | undefined

  /**
   * Create a page instance
   * @param ctx - Page context instance
   * @param path - Page path information
   */
  constructor(ctx: PageContext, path: PagePath) {
    this.ctx = ctx
    this.path = path
    this.uri = normalizePath(path.relativePath.replace(extname(path.relativePath), ''))
  }

  /**
   * Get page metadata
   * Parse configuration defined by definePage macro and return metadata for pages.json
   *
   * @param forceUpdate - Whether to force update, ignoring cache
   * @returns Page metadata object
   */
  public async getPageMeta(forceUpdate = false): Promise<PageMetaDatum> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { path, tabBar: _, ...others } = this.meta || {}

    return {
      path: path ?? this.uri,
      ...others,
    }
  }

  /**
   * Get page tabBar configuration
   * Extract tabBar related configuration from definePage macro
   *
   * @param forceUpdate - Whether to force update, ignoring cache
   * @returns tabBar configuration object, or undefined if page doesn't define tabBar
   */
  public async getTabBar(forceUpdate = false): Promise<TabBarItem & { index: number } | undefined> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { tabBar } = this.meta || {}

    if (tabBar === undefined) {
      return undefined
    }

    return {
      ...tabBar,
      pagePath: tabBar.pagePath || this.uri,
      index: tabBar.index ?? 0,
    }
  }

  /**
   * Check if the page has changed
   * @returns Whether the page has changed
   */
  public hasChanged() {
    return this.changed
  }

  /**
   * Read page file and parse metadata
   * Extract configuration defined by definePage macro from Vue SFC
   */
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
      const content = await fs.promises.readFile(this.path.absolutePath, { encoding: 'utf-8' })
      const sfc = parseSFC(content, { filename: this.path.absolutePath })

      const meta = await tryPageMetaFromMacro(sfc)
      if (meta) {
        return meta
      }

      return { type: 'page' }
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.relativePath}\n${err.message}`)
    }
  }
}

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
 * Try to extract page metadata defined by definePage macro from SFC
 * Support using definePage in script setup or regular script
 *
 * @param sfc - Vue SFC descriptor
 * @returns Page metadata object, or undefined if definePage is not found
 */
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

/**
 * Find definePage macro call in AST
 * Support function expressions, arrow functions and object expressions as arguments
 *
 * @param stmts - AST statement array
 * @param filename - Filename for error reporting
 * @returns definePage call expression, or undefined if not found
 */
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

/**
 * Extract all import declarations from AST
 * Used to provide necessary imports when executing definePage arguments
 *
 * @param stmts - AST statement array
 * @returns Import declaration array
 */
export function findImports(stmts: t.Statement[]): t.ImportDeclaration[] {
  const imports: t.ImportDeclaration[] = []
  for (const stmt of stmts) {
    if (t.isImportDeclaration(stmt)) {
      imports.push(stmt)
    }
  }
  return imports
}
