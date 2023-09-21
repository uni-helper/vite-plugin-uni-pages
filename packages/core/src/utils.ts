import process from 'node:process'
import Debug from 'debug'
import { type ModuleNode, type ViteDevServer, normalizePath } from 'vite'
import { groupBy } from 'lodash-unified'
import fg from 'fast-glob'
import type { SFCBlock } from '@vue/compiler-sfc'
import type { LoadConfigSource } from 'unconfig'
import { FILE_EXTENSIONS, RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import type { PageMetaDatum } from './types'
import { getRouteSfcBlock } from './customBlock'
import type { PagesConfig } from './config'

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

export function useCachedPages() {
  const pages = new Map<string, string>()

  function parseData(block?: SFCBlock) {
    return {
      content: block?.loc.source.trim() ?? '',
      attr: block?.attrs ?? '',
    }
  }

  function setCache(filePath: string, routeBlock?: SFCBlock) {
    pages.set(filePath, JSON.stringify(parseData(routeBlock)))
  }

  async function hasChanged(filePath: string, routeBlock?: SFCBlock) {
    if (!routeBlock)
      routeBlock = await getRouteSfcBlock(normalizePath(filePath))

    return !pages.has(filePath) || JSON.stringify(parseData(routeBlock)) !== pages.get(filePath)
  }

  return {
    setCache,
    hasChanged,
  }
}
