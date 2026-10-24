import type { FSWatcher } from 'chokidar'
import type { UniPagesPlugin, UserOptions } from './types'
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
export * from './directories'
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
  interface Parameters {
    root: string
    platform: string
    platformSuffix: boolean
  }
  interface Initialization {
    params: Parameters
    context: PageContext
    promise: Promise<UniPagesPlugin>
    prepared: boolean
    ready: boolean
    vite: boolean
    watching: boolean
    buildWatcher?: FSWatcher
    closing?: Promise<void>
  }
  let initialization: Initialization | undefined
  let preparedParams: Parameters | undefined

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
      try {
        return initialize(options.root ?? process.env.VITE_ROOT_DIR ?? process.cwd(), options.platformSuffix, 'prepare').promise
      }
      catch (error) {
        return Promise.reject(error)
      }
    },
    /**
     * Vite configResolved 钩子
     * 初始化 PageContext，设置 logger，生成初始 pages.json
     */
    async configResolved(config) {
      const state = initialize(config.root, config.plugins.some(v => v.name === 'vite-plugin-uni-platform'), 'vite')
      state.watching = config.command === 'build' && !!config.build.watch
      try {
        await state.promise
        if (state.closing)
          throw new Error('[vite-plugin-uni-pages] The pages context was closed during initialization.')
        if (state.watching) {
          const lockDirectory = normalizeConfigPath(`${state.context.resolvedPagesJSONPath}.lock`, config.root)
          state.buildWatcher = chokidar.watch([], {
            ignoreInitial: true,
            // 配置依赖按解析后的路径注册，目录恢复观察不递归跟随页面链接
            followSymlinks: false,
            ignored: (file) => {
              const absolute = normalizeConfigPath(file, config.root)
              return absolute.split('/').some(part => part === 'node_modules' || part === '.git')
                || absolute === lockDirectory || absolute.startsWith(`${lockDirectory}/`)
            },
          })
          await state.context.setupWatcher(state.buildWatcher)
        }
      }
      catch (error) {
        await release(state)
        throw error
      }
    },
    async closeWatcher() {
      if (initialization)
        await release(initialization)
    },
    async closeBundle() {
      if (initialization && !initialization.watching)
        await release(initialization)
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
      initialization?.context.setupViteServer(server)
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
        return initialization?.context.virtualModule()
    },
  }

  function initialize(root: string, platformSuffix: boolean, source: 'prepare' | 'vite'): Initialization {
    const resolvedRoot = normalizePath(path.resolve(root))
    const platform = process.env.UNI_PLATFORM
    if (!platform) {
      throw new Error('[vite-plugin-uni-pages] UNI_PLATFORM must be set before initializing pages. Run through the uni-app CLI or set the compilation platform before calling the plugin.')
    }
    const params = { root: resolvedRoot, platform, platformSuffix }
    if (initialization?.closing || (source === 'vite' && initialization?.vite))
      throw new Error('[vite-plugin-uni-pages] This plugin instance already has an active Vite session. Wait for it to close, or create a separate UniPages() instance for overlapping builds and servers.')

    const expected = preparedParams ?? initialization?.params
    const mismatched = expected && (Object.keys(params) as (keyof Parameters)[]).find(key => expected[key] !== params[key])
    if (mismatched)
      throw new Error(`[vite-plugin-uni-pages] ${mismatched} does not match the initialized pages context. Use the same root, UNI_PLATFORM and UniPlatform setting for prepare() and Vite.`)
    if (initialization) {
      if (source === 'prepare') {
        initialization.prepared = true
        if (initialization.ready)
          preparedParams = params
      }
      else {
        initialization.vite = true
      }
      return initialization
    }
    const context = new PageContext(userOptions, resolvedRoot, platform)
    context.withUniPlatform = platformSuffix
    context.setLogger(createLogger(undefined, { prefix: '[vite-plugin-uni-pages]' }))
    const state: Initialization = {
      params,
      context,
      prepared: source === 'prepare',
      ready: false,
      vite: source === 'vite',
      watching: false,
      // 先保存进行中状态，再开始生成，重复调用共享一次初始化
      promise: Promise.resolve().then(async () => {
        await context.updatePagesJSON()
        if (state.closing)
          throw new Error('[vite-plugin-uni-pages] The pages context was closed during initialization.')
        state.ready = true
        if (state.prepared)
          preparedParams = params
        return plugin
      }).catch(async (error) => {
        await context.disposeWatchers()
        if (initialization === state && !state.closing)
          initialization = undefined
        throw error
      }),
    }
    initialization = state
    return state
  }

  function release(state: Initialization): Promise<void> {
    if (!state.closing) {
      const disposing = state.context.disposeWatchers()
      state.closing = (async () => {
        try {
          await disposing
        }
        finally {
          await state.promise.catch(() => {})
          try {
            await state.buildWatcher?.close()
          }
          finally {
            if (initialization === state)
              initialization = undefined
          }
        }
      })()
    }
    return state.closing
  }

  return plugin
}

export default VitePluginUniPages
