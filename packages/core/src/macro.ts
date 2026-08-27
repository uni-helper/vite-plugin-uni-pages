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
 *
 * 两个入口都从 {@link parseSfcBlocks} 的块模型取宏：「两边按同一套
 * 规则找到同一个宏」由这个共享模型保证，不靠两边各自实现再对齐。
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

/** 一个 script 块解析后的产物 */
interface SfcScriptBlock {
  /** 块名（'<script setup>' 或 '<script>'），用于错误上报 */
  name: string
  /** 块内代码解析出的 AST 语句；解析失败的块为空数组 */
  body: t.Statement[]
  /** 块内的 import 声明，宏求值挑 import 时用 */
  imports: t.ImportDeclaration[]
  /** 本块解析失败时的错误；失败的块仍占位，错误留给调用方处理 */
  error?: unknown
}

/**
 * 把 SFC 的两个 script 块各自解析成 AST（共享的块模型）。
 *
 * 块序固定先 `<script setup>` 后 `<script>`；一个块解析失败不拦另一
 * 个块（宏多半写在另一个块里，比如 @babel/parser 8 删掉的旧版
 * `assert { ... }` import 属性会让还在用它的块失败）。失败记录在块
 * 的 `error` 上，由调用方决定上报还是抛出。
 *
 * @param code - Vue SFC 源码
 * @param filename - 用于错误提示和模块解析的 SFC 文件名
 * @returns 按固定顺序排列的块列表
 */
function parseSfcBlocks(code: string, filename: string): SfcScriptBlock[] {
  const sfc = parseSFC(code, { filename })
  const blocks: SfcScriptBlock[] = []

  for (const [name, script] of [['<script setup>', sfc.scriptSetup], ['<script>', sfc.script]] as const) {
    if (!script)
      continue

    try {
      const body = babelParse(script.content, script.lang || 'js').body
      blocks.push({ name, body, imports: findImports(body) })
    }
    catch (error: unknown) {
      blocks.push({ name, body: [], imports: [], error })
    }
  }

  return blocks
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
  const blocks = parseSfcBlocks(code, filename)

  for (const { body, error } of blocks) {
    if (error)
      continue

    const macro = findMacro(body, filename)
    if (!macro)
      continue

    const [macroOption] = macro.arguments
    // definePage() 没传参数：读不出任何配置，当作没写这个宏处理
    // （页面用默认配置，宏调用在转换时照样会删掉），而不是把 undefined
    // 交给 babel 生成器报一个看不懂的错
    if (!macroOption)
      return undefined
    const macroCode = babelGenerate(macroOption).code

    const parsed = await parseCode({
      // 宏用到的 import 可能写在另一个 script 块里（宏在 setup、常量
      // 在普通 <script>），两个块的 import 都参与挑选
      imports: pickEvalImports(blocks.map(block => block.imports), macroOption),
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

  // 没有任何块读出宏：有块解析失败时把第一个错误抛出去（调用方会警
  // 告并退回默认配置），完全没失败就说明文件里本来就没有 definePage
  const failed = blocks.find(block => block.error)
  if (failed)
    throw failed.error

  return undefined
}

/**
 * 在 Vue SFC 中定位 definePage 宏调用但不求值
 *
 * 转换插件用它找到宏再删掉，不求值。块解析失败通过 `onParseError`
 * 报出来，不抛错。
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
  for (const { name, body, error } of parseSfcBlocks(code, filename)) {
    if (error) {
      options.onParseError?.(name, error)
      continue
    }

    const macro = findMacro(body, filename)
    if (macro)
      return macro
  }

  return undefined
}

/**
 * 在 AST 中查找 definePage 宏调用
 * 支持函数表达式、箭头函数与对象表达式作为参数
 *
 * 已知限制：只在块的顶层语句里找，包进 if/try 等语句块里的调用
 * 不在此列（用户侧的说明写在 README 的 definePage 章节）
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
 * 从两个 script 块的全部 import 里，挑出宏参数真正用到的那些语句。
 *
 * 挑选按"名字被宏引用"来：没被用到的 import 不进沙箱，免得为了求值
 * 一个宏，把整个页面的依赖都加载一遍（比如普通 `<script>` 里 import
 * 的 `.vue` 组件，require 加载不动它，还会让本来好好的页面求值失败）。
 * 两个块里写了完全相同的 import 时只留一份，不然编译出的代码会重复
 * 声明同一个名字
 */
function pickEvalImports(allBlocks: t.ImportDeclaration[][], macroArg: t.Node): string[] {
  const referenced = new Set<string>()
  collectReferencedIdentifiers(macroArg, referenced)

  const codes = new Set<string>()
  for (const imports of allBlocks) {
    for (const imp of imports) {
      if (!imp.specifiers.some(spec => referenced.has(spec.local.name)))
        continue
      codes.add(babelGenerate(imp).code)
    }
  }
  return [...codes]
}

/**
 * 递归收集节点里出现的标识符名字。
 *
 * 故意宁可多收、不可漏收：`obj.key` 里的 key、`{ style: s }` 里的
 * style 这类"名字位置"的标识符也会被收进来。多收的后果只是多带一条
 * import（那条语句本来就写在用户自己的文件里），漏收才会让宏求值
 * 莫名失败
 */
function collectReferencedIdentifiers(node: unknown, names: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node)
      collectReferencedIdentifiers(item, names)
    return
  }
  if (node === null || typeof node !== 'object')
    return

  const astNode = node as t.Node
  if (astNode.type === 'Identifier') {
    names.add(astNode.name)
    return
  }
  // obj.key（非计算属性）：obj 是引用，key 只是名字，不跟进去
  if (astNode.type === 'MemberExpression' && !astNode.computed) {
    collectReferencedIdentifiers(astNode.object, names)
    return
  }
  // { key: value }（非计算属性）：只有 value 一边算引用
  if (astNode.type === 'ObjectProperty' && !astNode.computed) {
    collectReferencedIdentifiers(astNode.value, names)
    return
  }
  for (const [key, value] of Object.entries(astNode)) {
    if (key === 'loc')
      continue
    collectReferencedIdentifiers(value, names)
  }
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
      // createRequire 的参数按"文件名"解释，require 的相对路径从那个
      // 文件所在目录算起。要相对页面目录解析，就得给它一个"页面目录
      // 里的文件"；直接传目录名会让 `./xxx` 全部解析到页面目录的上一
      // 层（裸包名沿着 node_modules 往上找不受影响，所以这个错一直
      // 没被发现）。这个文件名只用来定位，不会真的去读它。
      // 另外 require 按 Node 规则解析：导入要写全扩展名，`./title.mjs`、
      // `./title.ts` 都行（engines 门槛内的 Node 自带 TS 剥离），TS 里
      // 省略扩展名的 `./title` 不行——require 不做 TS 的扩展名补全
      require: createRequire(path.join(dir, 'define-page.mjs')),
      // 宏代码里的动态 import() 会被上面的 TypeScript 编译改写成
      // require()，因此实际走不到这个绑定；留着它只是兜底（比如未来
      // 编译行为变化），注意它按插件自身位置解析、不按页面位置
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
