import Debug from 'debug'
import type { ModuleNode, ViteDevServer } from 'vite'
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
  error: Debug('vite-plugin-uni-pages:error'),
}

export function extsToGlob(extensions: string[]) {
  return extensions.length > 1 ? `{${extensions.join(',')}}` : extensions[0] || ''
}

export function isTargetFile(path: string) {
  const ext = path.split('.').pop()
  return FILE_EXTENSIONS.includes(ext!)
}
