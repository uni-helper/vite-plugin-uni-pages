import type { CallExpression } from '@babel/types'
import type { Plugin } from 'vite'
import type { UserOptions } from './types'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import { bold, dim, lightYellow, link } from 'kolorist'
import MagicString from 'magic-string'
import { createLogger } from 'vite'
import { babelParse } from './ast-kit'
import {
  FILE_EXTENSIONS,
  MODULE_ID_VIRTUAL,
  OUTPUT_NAME,
  RESOLVED_MODULE_ID_VIRTUAL,
} from './constant'
import { PageContext } from './context'
import { checkPagesJsonFile } from './files'
import { findMacro, parseSFC } from './page'

export * from './config'
export * from './constant'
export * from './context'
export * from './customBlock'
export * from './files'
export * from './options'
export * from './page'
export * from './types'
export * from './uni-platform'
export * from './utils'

async function restart() {
  return new Promise((resolve) => {
    const build = spawn(process.argv.shift()!, process.argv, {
      cwd: process.env.VITE_ROOT_DIR || process.cwd(),
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
    process.env.VITE_ROOT_DIR || process.cwd(),
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
      if (!FILE_EXTENSIONS.find(ext => id.endsWith(ext))) {
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

      const routeBlock = sfc.customBlocks.find(block => block.type === 'route')

      if (!macro && !routeBlock)
        return null

      if (macro && routeBlock)
        throw new Error(`不支持混合使用 definePage() 和 <route/> ${id}`)

      const s = new MagicString(code)
      if (macro)
        s.remove(macro.start!, macro.end!)

      if (routeBlock) {
        // eslint-disable-next-line no-console
        console.log(lightYellow('警告：'), `${bold('<route/>')} 标签已废弃，将在下一个版本中移除，请使用 definePage() 代替；${link('查看迁移指南', 'https://uni-helper.js.org/vite-plugin-uni-pages/definePage')}。`)
        // eslint-disable-next-line no-console
        console.log(dim(id))
        // eslint-disable-next-line no-console
        console.log()
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
