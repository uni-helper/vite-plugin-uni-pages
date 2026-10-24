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

/** 判断导入表达式能否交给 esbuild 收集依赖，未匹配的目标由运行时助手解析 */
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
 * 将脚本转换为绑定原文件位置的 JavaScript
 *
 * @description 注入运行时解析助手；可打包的调用及用户声明的局部 require 保持原语义
 * @param code 当前模块的源码文本
 * @param filename 当前模块的原始绝对路径，作为该模块运行时解析的基准
 * @param runtime 本轮生成的公共辅助模块路径，供转换后的代码导入
 * @returns 转换后的 JavaScript，包含映射到原模块的内联源码映射
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
  // 可枚举的调用保留给打包器，其余动态导入改为携带原模块 URL 的函数调用
  walkAST(ast, {
    enter(node) {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === requireName && isBundledSpecifier(node.arguments[0]))
        node.callee.name = 'require'
      if (node.type === 'ImportExpression' && !isBundledSpecifier(node.source))
        this.replace(callExpression(identifier(importName), [node.source, ...node.options ? [node.options] : []]))
    },
  })
  const url = JSON.stringify(pathToFileURL(filename).href)
  // 公共助手复用同一份实现，每个模块分别传入自己的 filename、dirname 和 URL
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

/**
 * 生成配置执行所需的公共辅助模块源码
 *
 * @description 调用方将返回文本写入本轮 runtime.mjs；各助手按传入的源位置解析，动态目标沿用 Node 缓存
 * @returns 可供配置打包使用的 ESM 源码
 */
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
