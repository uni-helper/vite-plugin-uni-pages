import type { Node } from '@babel/types'
import type { Loader } from 'esbuild'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import babelGenerate from '@babel/generator'
import { callExpression, identifier, removePropertiesDeep } from '@babel/types'
import { babelParse, walkAST } from 'ast-kit'
import { transform } from 'esbuild'

/** 保留字面量和 esbuild 可枚举的相对路径 glob，其他目标交给运行时解析 */
function isBundledSpecifier(node: Node | undefined): boolean {
  if (!node)
    return false
  if (node.type === 'StringLiteral')
    return true
  if (node.type === 'TemplateLiteral')
    return node.expressions.length === 0 || /^\.\.?\//.test(node.quasis[0].value.cooked ?? '')
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    let first: Node = node.left
    while (first.type === 'BinaryExpression' && first.operator === '+')
      first = first.left
    return first.type === 'StringLiteral' && /^\.\.?\//.test(first.value)
  }
  return false
}

/**
 * 为每个源模块绑定运行时解析位置
 *
 * @description 先由 esbuild 区分自由 require 与局部绑定，再恢复可打包的调用；不会改写用户声明的 require
 */
export async function transformConfigSource(code: string, filename: string, runtime: string): Promise<string> {
  let prefix = '__uni_pages_source'
  while (code.includes(prefix))
    prefix += '_'
  const requireName = `${prefix}_require`
  const metaName = `${prefix}_meta`
  const importName = `${prefix}_import`
  const extension = path.extname(filename).slice(1)
  const loader: Loader = extension === 'jsx' || extension === 'tsx' ? extension : /^(?:c|m)?js$/.test(extension) ? 'js' : 'ts'
  const result = await transform(code, {
    loader,
    sourcefile: filename,
    sourcemap: 'external',
    target: 'node22',
    define: {
      'require': requireName,
      'import.meta': metaName,
      '__dirname': JSON.stringify(path.dirname(filename)),
      '__filename': JSON.stringify(filename),
    },
  })
  const ast = babelParse(result.code, 'js', { allowReturnOutsideFunction: true })
  walkAST(ast, {
    enter(node) {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === requireName && isBundledSpecifier(node.arguments[0]))
        node.callee.name = 'require'
      if (node.type === 'ImportExpression' && !isBundledSpecifier(node.source))
        this.replace(callExpression(identifier(importName), [node.source, ...node.options ? [node.options] : []]))
    },
  })
  const url = JSON.stringify(pathToFileURL(filename).href)
  const helpers = babelParse(`
import { createRequire as ${prefix}_createRequire, createMeta as ${prefix}_createMeta, importFrom as ${prefix}_importFrom } from ${JSON.stringify(runtime)};
const ${requireName} = ${prefix}_createRequire(${JSON.stringify(filename)});
const ${metaName} = ${prefix}_createMeta(${JSON.stringify(filename)}, ${url}, ${JSON.stringify(path.dirname(filename))});
const ${importName} = (specifier, options) => ${prefix}_importFrom(specifier, ${url}, options);
`, 'js')
  removePropertiesDeep(helpers)
  ast.body.unshift(...helpers.body)
  const output = babelGenerate(ast, { sourceMaps: true, sourceFileName: filename, inputSourceMap: JSON.parse(result.map) }, result.code)
  return `${output.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(output.map)).toString('base64')}`
}

/** 仅供本轮 bundle 引用的运行时桥接，动态目标沿用 Node 的加载和缓存 */
export function configRuntimeSource(): string {
  return `
export { createRequire } from 'node:module';
import { resolve } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('import-meta-resolve')).href)};
export function createMeta(filename, url, dirname) {
  return Object.assign(Object.create(null), { filename, url, dirname, main: false, resolve: specifier => resolve(\`\${specifier}\`, url) });
}
export async function importFrom(specifier, url, options) {
  return import(resolve(\`\${specifier}\`, url), options);
}
`
}
