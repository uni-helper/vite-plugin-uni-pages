import vm from 'node:vm'
import path from 'node:path'
import { createRequire } from 'node:module'
import Debug from 'debug'
import type { ModuleNode, ViteDevServer } from 'vite'
import groupBy from 'lodash.groupby'
import * as ts from 'typescript'
import babelGenerator from '@babel/generator'
import { FILE_EXTENSIONS, RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import type { PageMetaDatum } from './types'

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
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText

  const dir = path.dirname(filename)

  // 创建一个新的虚拟机上下文
  const vmContext = {
    require: createRequire(dir),
    module: {},
    exports: {},
    __filename: filename,
    __dirname: dir,
  }

  // 使用 vm 模块执行 JavaScript 代码
  const script = new vm.Script(jsCode)

  try {
    script.runInNewContext(vmContext)
  }
  catch (error: any) {
    throw new Error(`${filename}: ${error.message}`)
  }

  // 获取导出的值
  const result = (vmContext.exports as any).default || vmContext.exports

  // 如果是函数，执行函数并返回其返回值
  if (typeof result === 'function') {
    return Promise.resolve(result())
  }

  // 如果不是函数，返回结果
  return Promise.resolve(result)
}

function getDefaultExport<T = any>(expr: T): T {
  return (expr as any).default === undefined ? expr : (expr as any).default
}

export const babelGenerate = getDefaultExport(babelGenerator)
