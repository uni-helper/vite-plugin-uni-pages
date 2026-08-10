import type { Plugin } from 'vite'
import type { UserOptions } from './types'
import process from 'node:process'
import chokidar from 'chokidar'
import MagicString from 'magic-string'
import { createLogger } from 'vite'
import {
  FILE_EXTENSIONS,
  MODULE_ID_VIRTUAL,
  RESOLVED_MODULE_ID_VIRTUAL,
} from './constant'
import { PageContext } from './context'
import { checkPagesJsonFileSync, resolvePagesJsonPath } from './files'
import { findDefinePageMacro } from './macro'

export * from './condition'
export * from './config'
export * from './constant'
export * from './context'
export * from './files'
export * from './logger'
export * from './macro'
export * from './options'
export * from './page'
export * from './pagesJson'
export * from './pipeline'
export * from './types'

/**
 * vite-plugin-uni-pages plugin main entry
 *
 * Automatically scan page directories and generate pages.json configuration file
 * Support definePage macro for defining page metadata
 * Support multi-platform conditional compilation
 * Support sub-package configuration
 * Support TypeScript declaration file generation
 *
 * @param userOptions - User configuration options
 * @returns Vite plugin instance
 */
export function VitePluginUniPages(userOptions: UserOptions = {}): Plugin {
  let ctx: PageContext

  // TODO: check if the pages.json file is valid
  // config.root is unknown until configResolved, so fall back to the same
  // root resolution Vite will use; the path rule itself lives in one place
  const resolvedPagesJSONPath = resolvePagesJsonPath(
    process.env.VITE_ROOT_DIR || process.cwd(),
    userOptions.outDir ?? 'src',
  )
  checkPagesJsonFileSync(resolvedPagesJSONPath)

  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    /**
     * Vite configResolved hook
     * Initialize PageContext, set logger, generate initial pages.json
     */
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
    /**
     * Code transform hook
     * Remove definePage macro calls from Vue SFC to avoid runtime errors
     */
    async transform(code: string, id: string) {
      if (!FILE_EXTENSIONS.some(ext => id.endsWith(ext))) {
        return null
      }

      // Each script block is parsed independently inside the macro module: a
      // syntax error in one block (e.g. the deprecated `assert { ... }` import
      // attributes removed in @babel/parser 8) must not skip macro removal in
      // the other block
      const macro = findDefinePageMacro(code, id, {
        onParseError: (block, error) => {
          this.warn(`[vite-plugin-uni-pages] Failed to parse ${block} in ${id}, its definePage macro may stay in the output: ${error instanceof Error ? error?.message : error}`)
        },
      })

      if (!macro)
        return null

      const s = new MagicString(code)
      s.remove(macro.start!, macro.end!)

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          // magic-string v1 types `sourcesContent` as `(string | null)[]`,
          // which rollup's `ExistingRawSourceMap` rejects; the serialized JSON
          // string is accepted by `SourceMapInput` and avoids the mismatch
          map: s.generateMap({
            source: id,
            includeContent: true,
            file: `${id}.map`,
          }).toString(),
        }
      }
    },
    /**
     * Configure server hook
     * Set up file watching and HMR support
     */
    configureServer(server) {
      ctx.setupViteServer(server)
    },
    /**
     * Module resolution hook
     * Resolve virtual module identifier to internal path
     */
    resolveId(id) {
      if (id === MODULE_ID_VIRTUAL)
        return RESOLVED_MODULE_ID_VIRTUAL
    },
    /**
     * Module load hook
     * Return the code content of the virtual module
     */
    load(id) {
      if (id === RESOLVED_MODULE_ID_VIRTUAL)
        return ctx.virtualModule()
    },
  }
}

export default VitePluginUniPages
