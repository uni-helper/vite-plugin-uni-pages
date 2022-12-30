import type { Plugin } from 'vite'
import type { UserOptions } from './types'
import { PageContext } from './context'
import { MODULE_ID_VIRTUAL, RESOLVED_MODULE_ID_VIRTUAL } from './constant'

export * from './config'

export const VitePluginUniPages = (userOptions: UserOptions = {}): Plugin => {
  let ctx: PageContext

  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    async configResolved(config) {
      ctx = new PageContext(userOptions, config.root)
      ctx.setLogger(config.logger)
      ctx.updatePagesJSON()
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
