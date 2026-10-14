import type { FSWatcher } from 'chokidar'
import type { InitializationSource, UniPagesPlugin, UserOptions } from './types'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import MagicString from 'magic-string'
import { createLogger, normalizePath } from 'vite'
import { normalizeConfigPath } from './config-loader'
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
 * 支持 definePage 宏定义页面配置
 * 支持多平台条件编译
 * 支持分包配置
 * 支持 TypeScript 声明文件生成
 *
 * @param userOptions - 用户配置项
 * @returns Vite 插件实例
 */
export function VitePluginUniPages(userOptions: UserOptions = {}): UniPagesPlugin {
  let ctx: PageContext
  let buildWatcher: FSWatcher | undefined
  /**
   * 当前初始化状态：`{ root, platform, platformSuffix }` 是它的参数，
   * 同时记下这次初始化是谁发起的（`source`）。
   *
   * `source` 用来区分两种“参数变了”：
   * - `'prepare'` 发起的，参数变了是真冲突，要报错（调用方明确指定了
   *   一套参数，却被另一套接管）
   * - `'vite'` 发起的，参数变了只是 Vite 又跑了一次 `resolveConfig`
   *   （嵌套构建、`build()` 复用一个插件实例、用户换了 root 或平台），
   *   这种情况下重建上下文，和这个钩子以前的行为一致
   */
  let initialization: {
    root: string
    platform: string
    platformSuffix: boolean
    source: InitializationSource
    promise: Promise<UniPagesPlugin>
  } | undefined

  // 保留普通用法的同步占位；推导目录不存在时跳过占位，不在可能错误的
  // 根目录创建目录。这里的 root 只能从 VITE_ROOT_DIR 或 cwd 猜，真正的
  // root 要等 prepare({ root }) 或 Vite 的 configResolved 才知道，占位
  // 留给那时用真实 root 跑的完整生成；root 真的不存在时，生成会以
  // ENOENT 失败并指明路径
  const resolvedPagesJSONPath = resolvePagesJsonPath(
    process.env.VITE_ROOT_DIR || process.cwd(),
    userOptions.outDir ?? 'src',
  )
  if (existsSync(path.dirname(resolvedPagesJSONPath)))
    checkPagesJsonFileSync(resolvedPagesJSONPath)

  const plugin: UniPagesPlugin = {
    name: 'vite-plugin-uni-pages',
    enforce: 'pre',
    prepare(options) {
      if (typeof options?.platformSuffix !== 'boolean') {
        return Promise.reject(new TypeError('[vite-plugin-uni-pages] prepare() requires an explicit boolean platformSuffix option.'))
      }
      return initialize(options.root ?? process.env.VITE_ROOT_DIR ?? process.cwd(), options.platformSuffix, 'prepare')
    },
    /**
     * Vite configResolved 钩子
     * 初始化 PageContext，设置 logger，生成初始 pages.json
     */
    async configResolved(config) {
      await initialize(config.root, config.plugins.some(v => v.name === 'vite-plugin-uni-platform'), 'vite')

      if (config.command === 'build') {
        if (config.build.watch) {
          // 必须相对真实的 Vite root 解析：否则 chokidar 会按 process.cwd()
          // 解释相对目录，在 root 与 cwd 不一致时监听到错误的目录
          const lockDirectory = normalizeConfigPath(`${ctx.resolvedPagesJSONPath}.lock`, config.root)
          buildWatcher = chokidar.watch([...ctx.options.dirs, ...ctx.options.subPackages].map(v => normalizePath(path.resolve(config.root, v))), {
            ignoreInitial: true,
            ignored: (file) => {
              const absolute = normalizeConfigPath(file, config.root)
              return absolute.split('/').some(part => part === 'node_modules' || part === '.git')
                || absolute === lockDirectory || absolute.startsWith(`${lockDirectory}/`)
            },
          })
          await ctx.setupWatcher(buildWatcher)
        }
      }
    },
    async closeWatcher() {
      await ctx?.disposeWatchers()
      await buildWatcher?.close()
      buildWatcher = undefined
    },
    async closeBundle() {
      if (!buildWatcher)
        await ctx?.disposeWatchers()
    },
    /**
     * 代码转换钩子
     * 从 Vue SFC 中移除 definePage 宏调用，避免运行时报错
     */
    async transform(code: string, id: string) {
      if (!FILE_EXTENSIONS.some(ext => id.endsWith(ext))) {
        return null
      }

      // 每个 script 块单独解析（在宏模块里）：一个块有语法错误
      // （比如 @babel/parser 8 删掉的旧 `assert { ... }` 写法），
      // 另一个块的宏照样能找到、照样删
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
          // magic-string v1 给 `sourcesContent` 的类型是
          // `(string | null)[]`，和 rollup 的 `ExistingRawSourceMap`
          // 对不上；转成 JSON 字符串后 `SourceMapInput` 能收，
          // 绕开了类型不匹配
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

  function initialize(root: string, platformSuffix: boolean, source: InitializationSource): Promise<UniPagesPlugin> {
    const resolvedRoot = normalizePath(path.resolve(root))
    const platform = process.env.UNI_PLATFORM
    if (!platform) {
      return Promise.reject(new Error('[vite-plugin-uni-pages] UNI_PLATFORM must be set before initializing pages. Run through the uni-app CLI or set the compilation platform before calling the plugin.'))
    }

    if (initialization) {
      const params = { root: resolvedRoot, platform, platformSuffix }
      const mismatched = (Object.entries(params) as [keyof typeof params, string | boolean][]).find(([key, value]) => initialization![key] !== value)?.[0]

      if (!mismatched)
        return initialization.promise

      // 已经跑完、且两边都不是 prepare() 发起的：Vite 自己又配了一次，
      // 按新参数重建。以前的代码每次 configResolved 都新建上下文，
      // 这里恢复那个行为
      if (initialization.source === 'vite' && source === 'vite') {
        initialization = undefined
      }
      else {
        return Promise.reject(new Error(`[vite-plugin-uni-pages] ${mismatched} does not match the initialized pages context. Use the same root, UNI_PLATFORM and UniPlatform setting for prepare() and Vite.`))
      }
    }

    const state = {
      root: resolvedRoot,
      platform,
      platformSuffix,
      source,
      // 先保存进行中状态，再开始生成，重复调用共享一次初始化
      promise: Promise.resolve().then(async () => {
        const context = new PageContext(userOptions, resolvedRoot, platform)
        context.withUniPlatform = platformSuffix
        context.setLogger(createLogger(undefined, { prefix: '[vite-plugin-uni-pages]' }))
        await context.updatePagesJSON()
        ctx = context
        return plugin
      }).catch((error) => {
        // 失败的上下文可能已有部分缓存，重试时重新创建
        if (initialization === state)
          initialization = undefined
        throw error
      }),
    }
    initialization = state
    return state.promise
  }

  return plugin
}

export default VitePluginUniPages
