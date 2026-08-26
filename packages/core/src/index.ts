import type { Plugin } from 'vite'
import type { UserOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { slash } from '@antfu/utils'
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
export * from './pages-json'
export * from './pipeline'
export type * from './types'
export type * from '@uni-helper/uni-pages-types'

/**
 * vite-plugin-uni-pages 插件主入口
 *
 * 自动扫描页面目录并生成 pages.json 配置文件
 * 支持 definePage 宏定义页面元信息
 * 支持多平台条件编译
 * 支持分包配置
 * 支持 TypeScript 声明文件生成
 *
 * @param userOptions - 用户配置项
 * @returns Vite 插件实例
 */
export function VitePluginUniPages(userOptions: UserOptions = {}): Plugin {
  let ctx: PageContext

  // TODO: 校验 pages.json 文件是否合法
  // config.root 在 configResolved 之前未知，这里退回到与 Vite 相同的根目录
  // 解析规则，让路径规则只维护一份。注意：当 Vite 的 root 与 cwd 不一致
  // （且未设置 VITE_ROOT_DIR）时，这个占位文件会落在错误的目录旁——
  // 它只是占位符，configResolved 中创建的 PageContext 在任何写入发生前
  // 总会基于 config.root 解析出真实路径。
  const resolvedPagesJSONPath = resolvePagesJsonPath(
    process.env.VITE_ROOT_DIR || process.cwd(),
    userOptions.outDir ?? 'src',
  )
  checkPagesJsonFileSync(resolvedPagesJSONPath)

  return {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    /**
     * Vite configResolved 钩子
     * 初始化 PageContext，设置 logger，生成初始 pages.json
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
        if (config.build.watch) {
          // 必须相对真实的 Vite root 解析：否则 chokidar 会按 process.cwd()
          // 解释相对目录，在 root 与 cwd 不一致时监听到错误的目录
          ctx.setupWatcher(chokidar.watch([...ctx.options.dirs, ...ctx.options.subPackages].map(v => slash(path.resolve(config.root, v)))))
        }
      }
    },
    /**
     * 代码转换钩子
     * 从 Vue SFC 中移除 definePage 宏调用，避免运行时报错
     */
    async transform(code: string, id: string) {
      if (!FILE_EXTENSIONS.some(ext => id.endsWith(ext))) {
        return null
      }

      // 每个script块在宏模块内部独立解析：其中一个块的语法错误（例如
      // @babel/parser 8 移除的旧版 `assert { ... }` 导入属性）不能导致
      // 另一个块的宏移除被跳过
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
          // magic-string v1 把 `sourcesContent` 类型化为 `(string | null)[]`，
          // 与 rollup 的 `ExistingRawSourceMap` 不兼容；序列化后的 JSON
          // 字符串可被 `SourceMapInput` 接受，规避了类型不匹配
          map: s.generateMap({
            source: id,
            includeContent: true,
            file: `${id}.map`,
          }).toString(),
        }
      }
    },
    /**
     * 配置开发服务器钩子
     * 设置文件监听与 HMR 支持
     */
    configureServer(server) {
      ctx.setupViteServer(server)
    },
    /**
     * 模块解析钩子
     * 将虚拟模块标识符解析为内部路径
     */
    resolveId(id) {
      if (id === MODULE_ID_VIRTUAL)
        return RESOLVED_MODULE_ID_VIRTUAL
    },
    /**
     * 模块加载钩子
     * 返回虚拟模块的代码内容
     */
    load(id) {
      if (id === RESOLVED_MODULE_ID_VIRTUAL)
        return ctx.virtualModule()
    },
  }
}

export default VitePluginUniPages
