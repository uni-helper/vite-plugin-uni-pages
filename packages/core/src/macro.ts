import type { CallExpression } from '@babel/types'
import type { SFCDescriptor, SFCParseOptions } from '@vue/compiler-sfc'
import type { UserPageItem } from './types'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import babelGenerate from '@babel/generator'
import * as t from '@babel/types'
import { platform as uniEnvPlatform } from '@uni-helper/uni-env'
import { parse as VueParser } from '@vue/compiler-sfc'
import { babelParse, isCallOf } from 'ast-kit'
import * as ts from 'typescript'
import { DefineConditional, isConditional } from './condition'
import { debug } from './logger'

/**
 * definePage 宏求值模块
 *
 * 深模块，封装理解一个 definePage 宏所需的全部细节：SFC 解析、按块
 * 隔离失败的 script 块解析、宏定位、导入收集与沙箱求值。调用方只见
 * 两个函数：evaluateDefinePage（扫描路径）与 findDefinePageMacro
 * （转换路径）。
 */

/**
 * 解析 Vue 单文件组件（SFC）
 * 兼容不同版本的 @vue/compiler-sfc
 *
 * @param code - Vue SFC 源码
 * @param options - 解析选项
 * @returns SFC descriptor 对象
 */
export function parseSFC(code: string, options?: SFCParseOptions): SFCDescriptor {
  return (
    VueParser(code, {
      pad: 'space',
      ...options,
    }).descriptor
    // 兼容 @vue/compiler-sfc ^2.7
    || (VueParser as any)({
      source: code,
      ...options,
    })
  )
}

/**
 * 求值 Vue SFC 中的 definePage 宏并返回页面元信息
 *
 * 供扫描路径使用。解析与求值失败会向上传播，调用方（Page.read）据此
 * 把该页面降级为仅含路径的元信息。
 *
 * @param code - Vue SFC 源码
 * @param filename - SFC 文件名，用于错误定位与模块解析
 * @param platform - 当前平台标识，注入函数式宏；默认取 uni-env 的平台
 * @returns 页面元信息对象；宏显式退出（definePage(null) 或返回 null 的
 * 函数）时为 `null`；找不到 definePage 时为 undefined
 */
export async function evaluateDefinePage(code: string, filename: string, platform: string = uniEnvPlatform): Promise<UserPageItem | null | undefined> {
  const sfc = parseSFC(code, { filename })
  const sfcScript = sfc.scriptSetup || sfc.script

  if (!sfcScript) {
    return undefined
  }

  // 导入属性（`with { ... }`）由 @babel/parser 8 原生支持。已废弃的
  // `assert { ... }` 语法在上游已被移除；这类文件在这里解析失败，错误
  // 传播到 Page.read()，页面降级为仅含路径的元信息（definePage 宏
  // 无法求值）。
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

  // 函数式宏接收当前平台与条件化 `define` 工厂，用户无需自己读取
  // process.env.UNI_PLATFORM 就能按平台分支
  const parsedMeta = typeof parsed === 'function'
    ? await parsed({ platform, define: (base: Record<string, any>) => new DefineConditional(base) })
    : parsed

  // 条件化定义在这里立即为当前平台解析，下游阶段因此始终只处理普通
  // 对象
  const resolvedMeta = isConditional(parsedMeta) ? parsedMeta.resolve(platform) : parsedMeta

  // 显式 null 表示该页面在本平台退出 pages.json
  if (resolvedMeta === null)
    return null

  return {
    type: 'page',
    ...resolvedMeta,
  }
}

/**
 * 在 Vue SFC 中定位 definePage 宏调用但不求值
 *
 * 供转换路径移除宏使用。每个 script 块独立解析：其中一个块的语法
 * 错误（例如 @babel/parser 8 移除的旧版 `assert { ... }` 导入属性）
 * 不能导致另一个块的宏移除被跳过。失败通过 `onParseError` 上报，
 * 不抛出。
 *
 * @param code - Vue SFC 源码
 * @param filename - 用于错误上报的 SFC 文件名
 * @param options - 可选的按块解析失败钩子
 * @param options.onParseError - 以失败的 script 块名与错误对象调用
 * @returns definePage 调用表达式，未找到时为 undefined
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
 * 在 AST 中查找 definePage 宏调用
 * 支持函数表达式、箭头函数与对象表达式作为参数
 *
 * @param stmts - AST 语句数组
 * @param filename - 用于错误上报的文件名
 * @returns definePage 调用表达式，未找到时为 undefined
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

  // 提取宏调用的第一个参数
  const [opt] = macro.arguments

  // 校验宏参数：仅支持函数、对象字面量或 null
  if (opt && !t.isFunctionExpression(opt) && !t.isArrowFunctionExpression(opt) && !t.isObjectExpression(opt) && !t.isNullLiteral(opt)) {
    debug.definePage(`definePage() only supports a function, object literal or null as argument: ${filename}`)
    return
  }

  return macro
}

/**
 * 从 AST 中提取全部导入声明
 * 用于在执行 definePage 参数时提供必要的导入
 *
 * @param stmts - AST 语句数组
 * @returns 导入声明数组
 */
function findImports(stmts: t.Statement[]): t.ImportDeclaration[] {
  return stmts.filter(t.isImportDeclaration)
}

/**
 * 将 TypeScript / JavaScript 脚本代码转换为对象/函数
 *
 * @param options - 脚本执行所需配置
 * @param options.imports - 需要包含的模块导入语句列表
 * @param options.code - 待执行的 TypeScript 代码内容
 * @param options.filename - 用于错误定位与上下文的脚本文件名
 * @returns 脚本执行结果，export 为函数时会执行并返回其返回值
 */
async function parseCode(options: { imports: string[], code: string, filename: string }): Promise<any> {
  const { imports = [], code, filename } = options

  let jsCode: string = ''
  try {
    const tmpCode = `${imports.join('\n')}\n export default ${code}`

    // 将 TypeScript 代码编译为 JavaScript
    jsCode = ts.transpileModule(tmpCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, // 生成 CommonJS 模块格式（Node.js 默认）
        target: ts.ScriptTarget.ES2022, // 编译后的目标 JavaScript 版本

        noEmit: true, // 不生成输出文件
        strict: false, // 关闭所有严格类型检查选项
        noImplicitAny: false, // 允许 any 类型的表达式
        strictNullChecks: false, // 关闭严格的 null 与 undefined 检查
        strictFunctionTypes: false, // 关闭函数参数的严格逆变比较
        strictBindCallApply: false, // 关闭 bind、call、apply 方法的严格类型检查
        strictPropertyInitialization: false, // 关闭类属性初始化的严格检查
        noImplicitThis: false, // 允许 this 表达式具有隐式 any 类型
        alwaysStrict: false, // 不以严格模式解析，也不为每个源文件生成 "use strict" 指令

        allowJs: true, // 允许编译 JavaScript 文件
        checkJs: false, // 不检查 JavaScript 文件中的类型
        skipLibCheck: true, // 跳过 TypeScript 声明文件 (*.d.ts) 的类型检查
        esModuleInterop: true, // 启用 ES 模块互操作，允许以 import 导入 CommonJS 模块
        removeComments: true, // 移除注释
      },
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone, // 不解析 JSDoc
    }).outputText

    const dir = path.dirname(filename)

    // 创建支持动态 import 的新 VM 上下文。
    // 这不是安全沙箱：故意暴露宿主的 `globalThis`（宏代码可能合法地
    // 读取 process.env 等），宏代码因此拥有完整的 Node 能力。vm 边界
    // 只防误伤——语法错误、死循环（超时）、意外的全局变量——不防恶意
    // 代码。definePage 本就是构建期的用户代码；安装一个不受信任的
    // 项目已经意味着信任它的开发期脚本。
    const vmContext = {
      module: {},
      exports: {},
      __filename: filename,
      __dirname: dir,
      require: createRequire(dir),
      import: (id: string) => import(id),

      // 定时器相关
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      clearImmediate,

      // 控制台相关
      console,

      // URL 处理
      URL,
      URLSearchParams,

      // 进程与性能相关
      performance,

      // 全局对象引用
      global: globalThis,
      globalThis,
    }

    // 使用 vm 模块执行 JavaScript 代码
    const script = new vm.Script(jsCode, { filename })

    await script.runInNewContext(vmContext, {
      timeout: 1000, // 设置超时，避免脚本长时间运行
    })

    // 取导出的值。`export default null` 转译为 `exports.default = null`，
    // 会被 `||` 兜底吞掉，因此按属性存在性取值而非按真值
    const exportsObj = vmContext.exports as any
    return 'default' in exportsObj ? exportsObj.default : exportsObj
  }
  catch (error: any) {
    throw new Error(`EXEC SCRIPT FAIL IN ${filename}: ${error.message} \n\n${jsCode}\n\n`)
  }
}
