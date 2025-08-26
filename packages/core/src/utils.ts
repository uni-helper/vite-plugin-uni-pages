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
 * 执行 TypeScript 代码字符串并返回其返回值
 * @param code - TypeScript 代码字符串
 * @returns 返回值
 */
export async function execScript(code: string, filename: string): Promise<any> {
  // 编译 TypeScript 代码为 JavaScript
  const jsCode = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext, // 改为 ESNext 以支持动态导入
      target: ts.ScriptTarget.ES2018,
      noEmit: true,
      strict: false,
      removeComments: true,
    },
    jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
  }).outputText

  const dir = path.dirname(filename)

  // 创建一个新的虚拟机上下文，支持动态导入
  const vmContext = {
    module: {
      _compile: (code: string, _filename: string) => {
        return new vm.Script(code).runInThisContext()
      },
    },
    exports: {},
    __filename: filename,
    __dirname: dir,
    require: createRequire(dir),
    // 提供一个 import 函数用于动态导入
    import: (id: string) => import(id),
  }

  // 包装代码以支持 ES 模块格式
  const wrappedCode = `
    (async () => {
      const module = { exports: {} };
      const exports = module.exports;
      const __dirname = "${dir.replace(/\\/g, '\\\\')}";
      const __filename = "${filename.replace(/\\/g, '\\\\')}";
      
      ${jsCode.replace(/require\(/g, 'await import(')}
      
      return module.exports;
    })()
  `

  try {
    const script = new vm.Script(wrappedCode, {
      filename,
    })

    const result = await script.runInNewContext(vmContext, {
      timeout: 1000, // 设置超时避免长时间运行
    })

    // 如果导出的是函数，执行它
    if (typeof result === 'function') {
      return Promise.resolve(result())
    }

    return Promise.resolve(result)
  }
  catch (error: any) {
    throw new Error(`${filename}: ${error.message}`)
  }
}

function getDefaultExport<T = any>(expr: T): T {
  return (expr as any).default === undefined ? expr : (expr as any).default
}

export const babelGenerate = getDefaultExport(babelGenerator)
