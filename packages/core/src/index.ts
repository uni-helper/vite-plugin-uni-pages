import path from 'path'
import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import chokidar from 'chokidar'
import type { UserOptions } from './types'
import { PageContext } from './context'
import { MODULE_ID_VIRTUAL, OUTPUT_NAME, RESOLVED_MODULE_ID_VIRTUAL } from './constant'
import { checkPagesJsonFile } from './files'

export * from './config'
export * from './types'
export * from './constant'
export * from './context'
export * from './utils'
export * from './files'
export * from './options'
export * from './customBlock'

export const VitePluginUniPages = (userOptions: UserOptions = {}): Plugin => {
  let ctx: PageContext

  // TODO: check if the pages.json file is valid
  const resolvedPagesJSONPath = path.join(process.cwd(), userOptions.outDir ?? 'src', OUTPUT_NAME)
  checkPagesJsonFile(resolvedPagesJSONPath)

  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    async configResolved(config) {
      ctx = new PageContext(userOptions, config.root)
      ctx.setLogger(config.logger)
      ctx.updatePagesJSON()

      if (config.build.watch && config.command === 'build')
        ctx.setupWatcher(chokidar.watch(ctx.options.dirs))
    },
    // Applet do not support custom route block, so we need to remove the route block here
    async transform(code: string, id: string) {
      if (!/\.vue$/.test(id))
        return null
      const s = new MagicString(code.toString())
      const routeBlockMatches = s.original.matchAll(/<route[^>]*>([\s\S]*?)<\/route>/g)

      for (const match of routeBlockMatches) {
        const index = match.index!
        const length = match[0].length
        s.remove(index, index + length)
      }
      return s.toString()
    },
    configureServer(server) {
      ctx.setupViteServer(server)
    },
    resolveId(id) {
      if (id === MODULE_ID_VIRTUAL)
        return RESOLVED_MODULE_ID_VIRTUAL
    },
    load(id) {
      if (id === RESOLVED_MODULE_ID_VIRTUAL)
        return ctx.virtualModule()
    },
  }
}

export default VitePluginUniPages
