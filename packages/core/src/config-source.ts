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
 * @returns 转换后的 JavaScript，包含映射到原模块的内联源码映射（内部已按成员替换 import.meta）
 */
export async function transformConfigSource(code: string, filename: string, runtime: string): Promise<string> {
  let prefix = '__uni_pages_source'
  while (code.includes(prefix))
    prefix += '_'
  const requireName = `${prefix}_require`
  const envName = `${prefix}_env`
  const resolveName = `${prefix}_resolve`
  const importName = `${prefix}_import`
  const extension = path.extname(filename).slice(1)
  const loader: Loader = extension === 'jsx' || extension === 'tsx' ? extension : /^(?:c|m)?js$/.test(extension) ? 'js' : 'ts'
  // 路径和 URL 每模块各自一份：同一个文件里 __dirname、import.meta.url
  // 和 require 的相对解析都必须以这个模块自己的位置为准
  const directory = path.dirname(filename)
  const url = pathToFileURL(filename).href
  const result = await transform(code, {
    loader,
    sourcefile: filename,
    sourcemap: 'external',
    target: 'node22',
    define: {
      'require': requireName,
      '__dirname': JSON.stringify(directory),
      '__filename': JSON.stringify(filename),
      'import.meta.url': JSON.stringify(url),
      'import.meta.dirname': JSON.stringify(directory),
      'import.meta.filename': JSON.stringify(filename),
      'import.meta.main': 'false',
      'import.meta.resolve': resolveName,
      'import.meta.env': envName,
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
  // 公共助手复用同一份实现；env 由 runtime 模块统一导出，各模块拿到的是同一个对象
  const helpers = babelParse(`
import { createRequire as ${prefix}_createRequire, env as ${envName}, resolveFrom as ${prefix}_resolveFrom, importFrom as ${prefix}_importFrom } from ${JSON.stringify(runtime)};
const ${requireName} = ${prefix}_createRequire(${JSON.stringify(filename)});
const ${resolveName} = specifier => ${prefix}_resolveFrom(specifier, ${JSON.stringify(url)});
const ${importName} = (specifier, options) => ${prefix}_importFrom(specifier, ${JSON.stringify(url)}, options);
`, 'js')
  removePropertiesDeep(helpers)
  ast.body.unshift(...helpers.body)
  const output = babelGenerate(ast, { sourceMaps: true, sourceFileName: filename, inputSourceMap: JSON.parse(result.map) }, result.code)
  return `${output.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(output.map)).toString('base64')}`
}

/**
 * 生成配置执行所需的公共辅助模块源码
 *
 * @description 调用方将返回文本写入本轮 runtime.mjs；env 是配置图里 import.meta.env 的唯一一份
 * @param env import.meta.env 的值，来自 Vite 解析后的 config.env 或进程环境兜底
 * @returns 供配置打包使用的 ESM 源码
 */
export function configRuntimeSource(env: Record<string, unknown>): string {
  return `
export { createRequire } from 'node:module';
import { resolve } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('import-meta-resolve')).href)};
export const env = ${JSON.stringify(env)};
export function resolveFrom(specifier, url) {
  return resolve(\`\${specifier}\`, url);
}
export async function importFrom(specifier, url, options) {
  return import(resolve(\`\${specifier}\`, url), options);
}
`
}
