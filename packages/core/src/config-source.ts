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

/** 加载器给 import.meta 提供取值的成员，其余成员保持 undefined */
const providedMetaMembers = new Set(['dirname', 'env', 'filename', 'main', 'resolve', 'url'])

/** 一处访问了加载器未提供成员的 import.meta 表达式 */
export interface ConfigMetaWarning {
  /** 访问所在模块的绝对路径 */
  file: string
  /** 1 起算的行号 */
  line: number
  /** 1 起算的列号 */
  column: number
  /** 成员名，例如 `glob` */
  member: string
}

/**
 * 找出模块里访问了加载器不提供的 import.meta 成员的位置
 *
 * @description 只在源码出现 `import.meta` 时解析；语法错误留给 esbuild 报，这里不重复
 * @param code 模块的原始源码，必须早于 esbuild 的 define 替换
 * @param filename 模块的绝对路径，决定按 TS 还是 JS 语法解析
 * @returns 按源码顺序排列的每处访问
 */
function findUnprovidedMetaMembers(code: string, filename: string): ConfigMetaWarning[] {
  if (!code.includes('import.meta'))
    return []
  const extension = path.extname(filename).slice(1)
  const lang = extension === 'tsx' ? 'tsx' : extension === 'jsx' ? 'jsx' : /^(?:ts|mts|cts)$/.test(extension) ? 'ts' : 'js'
  let ast: ReturnType<typeof babelParse>
  try {
    ast = babelParse(code, lang, { allowReturnOutsideFunction: true })
  }
  catch {
    return []
  }
  const warnings: ConfigMetaWarning[] = []
  walkAST(ast, {
    enter(node) {
      if (node.type !== 'MemberExpression' || node.object.type !== 'MetaProperty')
        return
      if (node.object.meta.name !== 'import' || node.object.property.name !== 'meta')
        return
      const member = node.property.type === 'Identifier'
        ? node.property.name
        : node.property.type === 'StringLiteral' ? node.property.value : undefined
      if (member === undefined || providedMetaMembers.has(member))
        return
      warnings.push({ file: filename, line: node.loc?.start.line ?? 0, column: (node.loc?.start.column ?? 0) + 1, member })
    },
  })
  return warnings
}

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

/** 一次源码转换的结果 */
export interface ConfigSourceTransform {
  /** 绑定原文件位置的 JavaScript，含映射回原模块的内联源码映射 */
  code: string
  /** 源码里访问了加载器不提供的 import.meta 成员的位置 */
  warnings: ConfigMetaWarning[]
}

/**
 * 将脚本转换为绑定原文件位置的 JavaScript
 *
 * @description 注入运行时解析助手；可打包的调用及用户声明的局部 require 保持原语义
 * import.meta 的解构、别名和计算式访问使用当前模块的源位置，各模块共享同一份 env
 * @param code 当前模块的源码文本
 * @param filename 当前模块的原始绝对路径，作为该模块运行时解析的基准
 * @param runtime 本轮生成的公共辅助模块路径，供转换后的代码导入
 * @returns 转换后的 JavaScript 及其发现的 import.meta 成员问题
 */
export async function transformConfigSource(code: string, filename: string, runtime: string): Promise<ConfigSourceTransform> {
  let prefix = '__uni_pages_source'
  while (code.includes(prefix))
    prefix += '_'
  const requireName = `${prefix}_require`
  const metaName = `${prefix}_meta`
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
      'import.meta': metaName,
      '__dirname': JSON.stringify(directory),
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
  // 公共助手复用同一份实现；env 由 runtime 模块统一导出，各模块拿到的是同一个对象
  const helpers = babelParse(`
import { createRequire as ${prefix}_createRequire, createMeta as ${prefix}_createMeta, importFrom as ${prefix}_importFrom } from ${JSON.stringify(runtime)};
const ${requireName} = ${prefix}_createRequire(${JSON.stringify(filename)});
const ${metaName} = ${prefix}_createMeta(${JSON.stringify(filename)}, ${JSON.stringify(url)}, ${JSON.stringify(directory)});
const ${importName} = (specifier, options) => ${prefix}_importFrom(specifier, ${JSON.stringify(url)}, options);
`, 'js')
  removePropertiesDeep(helpers)
  ast.body.unshift(...helpers.body)
  const output = babelGenerate(ast, { sourceMaps: true, sourceFileName: filename, inputSourceMap: JSON.parse(result.map) }, result.code)
  return {
    code: `${output.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(output.map)).toString('base64')}`,
    // 成员问题要在替换前查：define 跑完 import.meta 已经不在 AST 里了
    warnings: findUnprovidedMetaMembers(code, filename),
  }
}

/**
 * 生成配置执行所需的公共辅助模块源码
 *
 * @description 调用方将返回文本写入本轮 runtime.mjs；env 是配置图里 import.meta.env 的唯一一份
 * @param env import.meta.env 的值，来自 Vite 解析后的 config.env 或进程环境兜底
 * @param define Vite 的定义映射，只应用 import.meta.env.* 条目
 * @returns 供配置打包使用的 ESM 源码
 */
export async function configRuntimeSource(env: Record<string, unknown>, define: Record<string, unknown> = {}): Promise<string> {
  const prefix = 'import.meta.env.'
  const overrides = Object.entries(define).filter(([key]) => key.startsWith(prefix))
  let envSource = `export const env = ${JSON.stringify(env)};`
  if (overrides.length) {
    // 与 Vite 一样，字符串是替换表达式，其余值按 JSON 编码；交给 esbuild
    // 校验和替换。按字段首次读取时求值，避免无关的浏览器变量影响配置加载
    const values = overrides.map(([key]) => `${JSON.stringify(key.slice(prefix.length))}: () => ${key}`)
    const transformed = await transform(`const overrides = { ${values.join(', ')} };`, {
      loader: 'js',
      target: 'node22',
      define: Object.fromEntries(overrides.map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined'])),
    })
    envSource += `
${transformed.code}
function setEnvValue(key, value) {
  Object.defineProperty(env, key, { value, enumerable: true, configurable: true, writable: true });
  return value;
}
for (const [key, read] of Object.entries(overrides)) {
  let loaded = false;
  let value;
  Object.defineProperty(env, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (!loaded) {
        value = read();
        loaded = true;
      }
      if (Object.getOwnPropertyDescriptor(env, key)?.configurable)
        setEnvValue(key, value);
      return value;
    },
    set: value => setEnvValue(key, value),
  });
}
`
  }
  return `
export { createRequire } from 'node:module';
import { resolve } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('import-meta-resolve')).href)};
${envSource}
export function resolveFrom(specifier, url) {
  return resolve(\`\${specifier}\`, url);
}
export function createMeta(filename, url, dirname) {
  return Object.assign(Object.create(null), { filename, url, dirname, main: false, resolve: specifier => resolveFrom(specifier, url), env });
}
export async function importFrom(specifier, url, options) {
  return import(resolve(\`\${specifier}\`, url), options);
}
`
}
