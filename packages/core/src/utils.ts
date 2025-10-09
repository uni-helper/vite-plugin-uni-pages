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

export const debug = {
  hmr: Debug('vite-plugin-uni-pages:hmr'),
  routeBlock: Debug('vite-plugin-uni-pages:routeBlock'),
  options: Debug('vite-plugin-uni-pages:options'),
  pages: Debug('vite-plugin-uni-pages:pages'),
  subPages: Debug('vite-plugin-uni-pages:subPages'),
  error: Debug('vite-plugin-uni-pages:error'),
  cache: Debug('vite-plugin-uni-pages:cache'),
  declaration: Debug('vite-plugin-uni-pages:declaration'),
  definePage: Debug('vite-plugin-uni-pages:definePage'),
}

export function extsToGlob(extensions: string[]) {
  return extensions.length > 1 ? `{${extensions.join(',')}}` : (extensions[0] || '')
}

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
 * 将 TypeScript / JavaScript 脚本代码，转换为对象/函数
 *
 * @param options - 执行脚本所需的配置项
 * @param options.imports - 需要引入的模块导入语句列表
 * @param options.code - 实际要执行的 TypeScript 代码内容
 * @param options.filename - 脚本文件名，用于错误定位和上下文环境
 * @returns 返回脚本执行后的结果，若导出的是函数则执行后返回其返回值
 */
export async function parseCode(options: { imports: string[], code: string, filename: string }): Promise<any> {
  const { imports = [], code, filename } = options

  let jsCode: string = ''
  try {
    const tmpCode = `${imports.join('\n')}\n export default ${code}`

    // 编译 TypeScript 代码为 JavaScript
    jsCode = ts.transpileModule(tmpCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, // 生成的模块格式为 CommonJS（Node.js 默认格式）
        target: ts.ScriptTarget.ES2022, // 编译后的 JavaScript 目标版本

        noEmit: true, // 不生成输出文件
        strict: false, // 关闭所有严格类型检查选项
        noImplicitAny: false, // 允许表达式和 any 类型
        strictNullChecks: false, // 关闭严格的 null 和 undefined 检查
        strictFunctionTypes: false, // 关闭函数参数的严格逆变比较
        strictBindCallApply: false, // 关闭对 bind、call 和 apply 方法的严格类型检查
        strictPropertyInitialization: false, // 关闭类属性初始化的严格检查
        noImplicitThis: false, // 允许 this 表达式具有隐式的 any 类型
        alwaysStrict: false, // 不以严格模式解析并为每个源文件生成 "use strict" 指令

        allowJs: true, // 允许编译 JavaScript 文件
        checkJs: false, // 不检查 JavaScript 文件中的类型
        skipLibCheck: true, // 跳过对 TypeScript 声明文件 (*.d.ts) 的类型检查
        esModuleInterop: true, // 启用 ES 模块互操作性，允许使用 import 导入 CommonJS 模块
        removeComments: true, // 删除注释
      },
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone, // 不解析 JSDoc
    }).outputText

    const dir = path.dirname(filename)

    // 创建一个新的虚拟机上下文，支持动态导入
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

      // 进程和性能相关
      performance,

      // 全局对象引用
      global: globalThis,
      globalThis,
    }

    // 使用 vm 模块执行 JavaScript 代码
    const script = new vm.Script(jsCode, { filename })

    await script.runInNewContext(vmContext, {
      timeout: 1000, // 设置超时避免长时间运行
    })

    // 获取导出的值
    const result = (vmContext.exports as any).default || vmContext.exports

    // 返回结果
    return result
  }
  catch (error: any) {
    throw new Error(`EXEC SCRIPT FAIL IN ${filename}: ${error.message} \n\n${jsCode}\n\n`)
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getDefaultExport<T = any>(expr: T): T {
  return (expr as any).default === undefined ? expr : (expr as any).default
}

export const babelGenerate = getDefaultExport(babelGenerator)
