import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Plugin } from 'vite'
import { createLogger } from 'vite'
import MagicString from 'magic-string'
import chokidar from 'chokidar'
import type { UserOptions } from './types'
import { PageContext } from './context'
import {
  DEFINE_PAGE,
  MODULE_ID_VIRTUAL,
  OUTPUT_NAME,
  RESOLVED_MODULE_ID_VIRTUAL,
} from './constant'
import { checkPagesJsonFile } from './files'
import { findMacro } from './page'
import { isTargetFile, parseSFC } from './utils'

export * from './config'
export * from './types'
export * from './constant'
export * from './context'
export * from './utils'
export * from './files'
export * from './options'
export * from './page'

async function restart() {
  return new Promise((resolve) => {
    const build = spawn(process.argv.shift()!, process.argv, {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
    })
    build.stdout?.pipe(process.stdout)
    build.stderr?.pipe(process.stderr)
    build.on('close', (code) => {
      resolve(process.exit(code!))
    })
  })
}

export function VitePluginUniPages(userOptions: UserOptions = {}): Plugin {
  let ctx: PageContext

  // TODO: check if the pages.json file is valid
  const resolvedPagesJSONPath = path.join(
    process.cwd(),
    userOptions.outDir ?? 'src',
    OUTPUT_NAME,
  )
  const isValidated = checkPagesJsonFile(resolvedPagesJSONPath)

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
        if (!isValidated) {
          ctx.logger?.warn('In build mode, if `pages.json` does not exist, the plugin cannot create the complete `pages.json` before the uni-app, so it restarts the build.', {
            timestamp: true,
          })
          await restart()
        }

        if (config.build.watch)
          ctx.setupWatcher(chokidar.watch([...ctx.options.dirs, ...ctx.options.subPackages]))
      }
    },
    // Applet do not support custom route block, so we need to remove the route block here
    async transform(code: string, id: string) {
      if (!isTargetFile(id))
        return null

      const sfc = await parseSFC(code, { filename: id })

      const macro = findMacro(sfc.scriptSetup)
      const routeBlock = sfc.customBlocks.find(block => block.type === 'route')

      if (!macro && !routeBlock)
        return null

      if (macro && routeBlock)
        throw new Error(`mixed ${DEFINE_PAGE}() and <route/> is not allowed`)

      const s = new MagicString(code)

      if (macro)
        s.remove(macro.start!, macro.end!)

      if (routeBlock) {
        const routeBlockMatches = s.original.matchAll(
          /<route[^>]*>([\s\S]*?)<\/route>/g,
        )

        for (const match of routeBlockMatches) {
          const index = match.index!
          const length = match[0].length
          s.remove(index, index + length)
        }
      }

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
