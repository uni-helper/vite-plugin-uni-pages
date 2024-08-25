import Debug from 'debug'
import { type ModuleNode, type ViteDevServer, normalizePath } from 'vite'
import groupBy from 'lodash.groupby'
import type { SFCDescriptor } from '@vue/compiler-sfc'
import { FILE_EXTENSIONS, RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import type { PageMetaDatum, ResolvedOptions } from './types'
import { getRouteBlock, getRouteSfcBlock } from './customBlock'
import { readPageOptionsFromMacro } from './definePage'

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

  async function parseData(filePath: string, sfcDescriptor: SFCDescriptor, options: ResolvedOptions) {
    const routeSfcBlock = await getRouteSfcBlock(sfcDescriptor)
    const routeBlock = await getRouteBlock(filePath, routeSfcBlock, options)
    const pageMetaDatum: PageMetaDatum = {
      path: normalizePath(filePath),
      type: routeBlock?.attr.type ?? 'page',
    }
    const definePageData = await readPageOptionsFromMacro(sfcDescriptor)
    Object.assign(pageMetaDatum, definePageData)
    return pageMetaDatum
  }

  function setCache(filePath: string, pageMetaDatum?: PageMetaDatum) {
    debug.cache('filePath', filePath)
    const { path, ...rest } = pageMetaDatum ?? {}
    pages.set(filePath, JSON.stringify(rest))
  }

  async function hasChanged(filePath: string, sfcDescriptor: SFCDescriptor, options: ResolvedOptions) {
    const pageMetaDatum = await parseData(filePath, sfcDescriptor, options)
    const { path, ...rest } = pageMetaDatum ?? {}
    const changed = !pages.has(filePath) || JSON.stringify(rest) !== pages.get(filePath)
    debug.cache('page changed', changed)
    return changed
  }

  return {
    setCache,
    hasChanged,
    parseData,
  }
}
