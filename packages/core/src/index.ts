import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import chokidar from 'chokidar'
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
      if (config.build.watch && config.command === 'build')
        ctx.setupWatcher(chokidar.watch(ctx.options.dirs))
    },
    // 小程序不支持自定义 route block，所以这里需要把route block去掉
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
