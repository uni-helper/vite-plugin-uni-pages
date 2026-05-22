import type { CallExpression } from '@babel/types'
import type { Plugin } from 'vite'
import type { UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { babelParse } from 'ast-kit'
import chokidar from 'chokidar'
import MagicString from 'magic-string'
import { createLogger } from 'vite'
import {
  FILE_EXTENSIONS,
  MODULE_ID_VIRTUAL,
  OUTPUT_NAME,
  RESOLVED_MODULE_ID_VIRTUAL,
} from './constant'
import { PageContext } from './context'
import { checkPagesJsonFileSync } from './files'
import { findMacro, parseSFC } from './page'

export * from './config'
export * from './constant'
export * from './context'
export * from './files'
export * from './options'
export * from './page'
export * from './types'
export * from './utils'

export function VitePluginUniPages(userOptions: UserOptions = {}): Plugin {
  let ctx: PageContext

  // TODO: check if the pages.json file is valid
  const resolvedPagesJSONPath = path.join(
    process.env.VITE_ROOT_DIR || process.cwd(),
    userOptions.outDir ?? 'src',
    OUTPUT_NAME,
  )
  checkPagesJsonFileSync(resolvedPagesJSONPath)

  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    async configResolved(config) {
      ctx = new PageContext(userOptions, config.root)

      if (config.plugins.some(v => v.name === 'vite-plugin-uni-platform'))
        ctx.withUniPlatform = true

      const logger = createLogger(undefined, {
        prefix: '[vite-plugin-uni-pages]',
      })
      ctx.setLogger(logger)
      await ctx.updatePagesJSON()

      if (config.command === 'build') {
        if (config.build.watch)
          ctx.setupWatcher(chokidar.watch([...ctx.options.dirs, ...ctx.options.subPackages]))
      }
    },
    async transform(code: string, id: string) {
      if (!FILE_EXTENSIONS.some(ext => id.endsWith(ext))) {
        return null
      }

      const sfc = parseSFC(code, { filename: id })

      let macro: CallExpression | undefined
      if (sfc.scriptSetup) {
        const ast = babelParse(sfc.scriptSetup.content, sfc.scriptSetup.lang || 'js')
        macro = findMacro(ast.body, sfc.filename)
      }

      if (!macro && sfc.script) {
        const ast = babelParse(sfc.script.content, sfc.script.lang || 'js')
        macro = findMacro(ast.body, sfc.filename)
      }

      if (!macro)
        return null

      const s = new MagicString(code)
      s.remove(macro.start!, macro.end!)

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({
            source: id,
            includeContent: true,
            file: `${id}.map`,
          }),
        }
      }
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
