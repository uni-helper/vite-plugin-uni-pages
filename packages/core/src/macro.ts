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
 * definePage 宏的解析与求值
 *
 * 这个文件负责看懂一个 definePage 宏要的全部步骤：解析 Vue 单文件
 * 组件、逐个 script 块解析（单个块失败不影响别的块）、找到宏调用、
 * 收集 import 语句、放进沙箱求值。外部只用两个函数：
 * evaluateDefinePage（扫描时用）和 findDefinePageMacro（转换时用）。
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
 * 求值 Vue SFC 里的 definePage 宏，返回页面信息
 *
 * 扫描时用。解析或求值出错时，错误会交给调用方（Page.read），它会把
 * 这个页面退回成只含路径的简单信息。
 *
 * @param code - Vue SFC 源码
 * @param filename - SFC 文件名，用于错误提示和模块解析
 * @param platform - 当前平台标识，传给函数式宏；默认取 uni-env 的平台
 * @returns 页面信息对象；宏明确退出（definePage(null) 或函数返回
 * null）时为 `null`；没找到 definePage 时为 undefined
 */
export async function evaluateDefinePage(code: string, filename: string, platform: string = uniEnvPlatform): Promise<UserPageItem | null | undefined> {
  const sfc = parseSFC(code, { filename })

  // 两个 script 块都找（先 setup 后普通，和 findDefinePageMacro 的
  // 顺序一致）。旧代码只看其中一个：宏写在普通 <script> 里而页面
  // 还有 <script setup> 时，扫描这边读不到配置，转换那边却会把宏
  // 删掉——配置悄悄丢掉，还不留任何痕迹
  for (const sfcScript of [sfc.scriptSetup, sfc.script]) {
    if (!sfcScript)
      continue

    // import 属性（`with { ... }`）@babel/parser 8 直接支持。旧的
    // `assert { ... }` 写法已废弃、@babel/parser 8 删掉了支持，还在用
    // 这种写法的文件会在这里解析失败，错误交给 Page.read() 处理，页面
    // 只保留路径信息（definePage 宏读不出来了）。
    const ast = babelParse(sfcScript.content, sfcScript.lang || 'js')
    const macro = findMacro(ast.body, filename)
    if (!macro)
      continue

    const imports = findImports(ast.body).filter(imp => !!imp.specifiers.length).map(imp => babelGenerate(imp).code)

    const [macroOption] = macro.arguments
    // definePage() 没传参数：读不出任何配置，当作没写这个宏处理
    // （页面用默认配置，宏调用在转换时照样会删掉），而不是把 undefined
    // 交给 babel 生成器报一个看不懂的错
    if (!macroOption)
      return undefined
    const macroCode = babelGenerate(macroOption).code

    const parsed = await parseCode({
      imports,
      code: macroCode,
      filename,
    })

    // 写成函数的 definePage 会收到当前平台和一个 define() 帮手，
    // 用户不用自己读 process.env.UNI_PLATFORM 就能按平台写不同配置
    const parsedMeta = typeof parsed === 'function'
      ? await parsed({ platform, define: (base: Record<string, any>) => new DefineConditional(base) })
      : parsed

    // define() 写的条件配置马上在这里按当前平台算出结果，
    // 后面的步骤只会见到普通对象
    const resolvedMeta = isConditional(parsedMeta) ? parsedMeta.resolve(platform) : parsedMeta

    // 显式 null 表示该页面在本平台退出 pages.json
    if (resolvedMeta === null)
      return null

    return {
      type: 'page',
      ...resolvedMeta,
    }
  }

  return undefined
}

/**
 * 在 Vue SFC 中定位 definePage 宏调用但不求值
 *
 * 转换插件用它找到宏再删掉，不求值。每个 script 块单独解析：其中
 * 一个块有语法错误（比如还在用 @babel/parser 8 已删除的旧版
 * `assert { ... }` import 属性）时，另一个块的宏照样能找到、照样删。
 * 解析失败通过 `onParseError` 报出来，不抛错。
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

    // 取导出的值。`export default null` 转出来的结果是
    // `exports.default = null`；如果用 `||` 取值，null 会被当成
    // "没有值"而丢掉，所以要看属性在不在，而不是看值是不是真的
    const exportsObj = vmContext.exports as any
    return 'default' in exportsObj ? exportsObj.default : exportsObj
  }
  catch (error: any) {
    throw new Error(`EXEC SCRIPT FAIL IN ${filename}: ${error.message} \n\n${jsCode}\n\n`)
  }
}
