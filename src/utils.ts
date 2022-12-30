import { resolve } from 'path'
import Debug from 'debug'
import { slash } from '@antfu/utils'
import type { ModuleNode, ViteDevServer } from 'vite'
import type { ResolvedOptions } from './types'
import { RESOLVED_MODULE_ID_VIRTUAL } from './constant'

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
  search: Debug('vite-plugin-uni-pages:search'),
  env: Debug('vite-plugin-uni-pages:env'),
  cache: Debug('vite-plugin-uni-pages:cache'),
  resolver: Debug('vite-plugin-uni-pages:resolver'),
  error: Debug('vite-plugin-uni-pages:error'),
}

export function extsToGlob(extensions: string[]) {
  return extensions.length > 1 ? `{${extensions.join(',')}}` : extensions[0] || ''
}

export function isPagesDir(path: string, options: ResolvedOptions) {
  for (const dir of options.dirs) {
    const dirPath = slash(resolve(options.root, dir))
    if (path.startsWith(dirPath))
      return true
  }
  return false
}
