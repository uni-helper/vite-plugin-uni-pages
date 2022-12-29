import type { ModuleNode, Plugin } from 'vite'
import { normalizePath } from 'vite'
import type { ResolvedOptions, UserOptions } from './types'
import { isPagePath, logger } from './utils'
import { resolvedVirtualModuleId, virtualModuleId } from './constant'
import { Context } from './context'

export * from './config'

function resolveOptions(userOptions: UserOptions): ResolvedOptions {
  return {
    pagesDir: 'src/pages',
    outDir: 'src',
    exclude: [],
    onBeforeLoadUserConfig: () => {},
    onAfterLoadUserConfig: () => {},
    onBeforeScanPages: () => {},
    onAfterScanPages: () => {},
    onBeforeMergePagesMeta: () => {},
    onAfterMergePagesMeta: () => {},
    onBeforeWriteFile: () => {},
    onAfterWriteFile: () => {},
    ...userOptions,
  }
}

export const VitePluginUniPages = async (
  userOptions: UserOptions = {},
): Promise<Plugin> => {
  const options = resolveOptions(userOptions)
  logger.debug('Create uni-pages context with', options)
  const ctx = new Context(options)
  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    async configureServer({ watcher, moduleGraph, ws }) {
      const pagesConfigSourcePaths = await ctx.pagesConfigSourcePaths()
      logger.debug('Add watcher', pagesConfigSourcePaths)
      watcher.add(pagesConfigSourcePaths)

      const reloadModule = (module: ModuleNode | undefined, path = '*') => {
        if (module) {
          moduleGraph.invalidateModule(module)
          if (ws) {
            ws.send({
              path,
              type: 'full-reload',
            })
          }
        }
      }
      const updateVirtualModule = () => {
        logger.debug('Update virtualModule')
        const module = moduleGraph.getModuleById(resolvedVirtualModuleId)
        reloadModule(module)
      }

      watcher.on('change', async (path) => {
        if (
          pagesConfigSourcePaths.includes(normalizePath(path))
          || isPagePath(path, options)
        ) {
          await ctx.createOrUpdatePagesJSON()
          updateVirtualModule()
        }
      })
      watcher.on('add', async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON()
          updateVirtualModule()
        }
      })
      watcher.on('unlink', async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON()
          updateVirtualModule()
        }
      })
    },
    resolveId(id) {
      if (id === virtualModuleId)
        return resolvedVirtualModuleId
    },

    load(id) {
      if (id === resolvedVirtualModuleId)
        return ctx.virtualModule()
    },
  }
}

export default VitePluginUniPages
