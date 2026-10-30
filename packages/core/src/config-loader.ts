import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import type { ConfigMetaWarning } from './config-source'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { bundleRequire } from 'bundle-require'
import { loadConfig } from 'unconfig'
import { normalizePath } from 'vite'
import { configRuntimeSource, transformConfigSource } from './config-source'
import { debug } from './logger'

const scriptExtensions = /\.[cm]?[jt]sx?$/
/** 目录恢复监听接受的文件类型；已知配置入口与依赖不受此限制 */
export const configFileExtensions = /\.(?:[cm]?[jt]sx?|json)$/
/** 省略扩展名时 esbuild 会依次尝试的后缀，用于列举恢复候选文件 */
const candidateExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json']
/** TS 约定里 `./x.js` 指向的就是 `./x.ts`，恢复候选也得列上 */
const typescriptAliases: Record<string, string[]> = { '.cjs': ['.cts'], '.js': ['.ts', '.tsx'], '.mjs': ['.mts'] }

function isNodeModulesPath(filepath: string): boolean {
  return normalizePath(filepath).split('/').includes('node_modules')
}

/** JSON 文件可能带 BOM 保存，JSON.parse 不接受它 */
function stripBom(code: string): string {
  return code.charCodeAt(0) === 0xFEFF ? code.slice(1) : code
}

/**
 * 由失败的导入说明符推出可能出现的文件
 *
 * @description `./missing/title` 这种缺扩展名的写法，创建 `title.ts`
 * 或 `title/index.ts` 都算恢复，所以两种形态都要列出来
 */
function recoveryCandidatesFor(specifier: string, importerDirectory: string): string[] {
  const base = path.resolve(importerDirectory, specifier)
  const candidates = candidateExtensions.map(extension => `${base}${extension}`)
  for (const extension of candidateExtensions.slice(1))
    candidates.push(path.join(base, `index${extension}`))
  // `./typed.js` 在 TS 里落到 typed.ts；写死扩展名时只剩这一种可能
  for (const [extension, aliases] of Object.entries(typescriptAliases)) {
    if (base.endsWith(extension)) {
      for (const alias of aliases)
        candidates.push(`${base.slice(0, -extension.length)}${alias}`)
    }
  }
  return candidates
}

/** 将已存在和暂时缺失的文件统一到同一绝对路径 */
export function normalizeConfigPath(filepath: string, root: string): string {
  const absolute = path.resolve(root, normalizePath(filepath))
  let parent = absolute
  while (!existsSync(parent) && path.dirname(parent) !== parent)
    parent = path.dirname(parent)
  try {
    return normalizePath(path.join(realpathSync.native(parent), path.relative(parent, absolute)))
  }
  catch {
    return normalizePath(absolute)
  }
}

/** 返回可用于监听缺失文件恢复的现存祖先目录 */
export function configWatchDirectory(filepath: string): string {
  let directory = path.dirname(filepath)
  while (!existsSync(directory) && path.dirname(directory) !== directory)
    directory = path.dirname(directory)
  return normalizePath(directory)
}

/**
 * 判断路径是否位于加载器专用产物目录内
 *
 * @param filepath 待判断的绝对路径，应已通过 {@link normalizeConfigPath} 归一化
 * @param directory 专用产物目录的绝对路径；目录本身也算产物
 * @returns 位于目录内时返回 true，相邻前缀或父路径返回 false
 */
export function isConfigLoaderArtifact(filepath: string, directory: string): boolean {
  const relative = path.relative(directory, filepath)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * 没有 Vite 配置时的 import.meta.env
 *
 * @description 只给 Vite 会在 app 代码里提供的键：前缀变量加标准键。
 * prepare() 在 Vite 解析配置之前运行，`.env` 文件的值此时还没有人读过
 */
function fallbackConfigEnv(): Record<string, unknown> {
  const env: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.startsWith('VITE_'))
      env[key] = value
  }
  const production = process.env.NODE_ENV === 'production'
  return {
    ...env,
    BASE_URL: '/',
    MODE: process.env.NODE_ENV ?? 'development',
    DEV: !production,
    PROD: production,
    SSR: false,
  }
}

/** 配置加载结果及这次成功求值涉及的文件 */
export interface LoadedPagesConfig {
  config: PagesConfig
  sources: string[]
  dependencies: string[]
}

/** 一次加载需要监听的输入；失败时保留上次成功的依赖并补入恢复路径 */
export interface ConfigWatchInput {
  sources: string[]
  dependencies: string[]
  recoveryCandidates: string[]
  recoveryDirectories: string[]
}

/**
 * 页面配置加载器
 *
 * @description 按配置源顺序发现并加载首个有效配置，返回配置对象及依赖路径；加载失败时记录恢复路径并抛出错误
 */
export class PagesConfigLoader {
  /** 装载失败时仍需监听重建的入口与已尝试路径 */
  readonly recoveryPaths = new Set<string>()
  /** 这次失败中具体缺哪个文件；优先按它判断，命中时不看目录 */
  readonly recoveryCandidates = new Set<string>()
  /** 目录导入的恢复范围，覆盖 package.json 和自定义入口 */
  readonly recoveryDirectories = new Set<string>()
  private readonly knownSources = new Set<string>()
  /** 临时工作目录的物理路径，每轮加载创建独占子目录，输入索引与事件过滤排除此目录 */
  readonly artifactDirectory: string
  /** 最近一次成功加载的入口及其依赖，失败恢复以它为基准 */
  private lastSources: string[] = []
  private lastDependencies: string[] = []
  /** 最近一次加载尝试的监听输入；失败时也保留可恢复路径 */
  private currentWatchInput: ConfigWatchInput = {
    sources: [],
    dependencies: [],
    recoveryCandidates: [],
    recoveryDirectories: [],
  }

  /** 配置图里 import.meta.env 的值，Vite 会话就绪后可能被替换 */
  private env: Record<string, unknown>
  private readonly warn?: (message: string) => void
  /** 同一文件同一成员只提示一次；watch 每轮都会重新转换所有输入 */
  private readonly reportedMetaMembers = new Set<string>()

  /**
   * @param root - 项目根目录，配置入口和依赖都按它解析
   * @param warn - 提示出口，同一文件同一成员只调用一次
   */
  constructor(private readonly root: string, warn?: (message: string) => void) {
    this.artifactDirectory = normalizeConfigPath(path.join(root, 'node_modules/.cache/uni-pages'), root)
    this.env = fallbackConfigEnv()
    this.warn = warn
  }

  /**
   * 替换配置图里 import.meta.env 的值
   *
   * @param env - 与 Vite 给 app 代码注入的 import.meta.env 一致的值；下一轮加载生效
   */
  setEnv(env: Record<string, unknown>): void {
    this.env = env
  }

  /** 把成员问题转成带文件位置的提示；同一文件同一成员只报一次 */
  private reportMetaWarnings(warnings: ConfigMetaWarning[]): void {
    if (!this.warn)
      return
    for (const { file, line, column, member } of warnings) {
      const key = `${file}\u0000${member}`
      if (this.reportedMetaMembers.has(key))
        continue
      this.reportedMetaMembers.add(key)
      this.warn(`${normalizePath(path.relative(this.root, file))}:${line}:${column} reads import.meta.${member}, which is not available while the pages config runs. Read environment values from process.env, and move other Vite-only access out of the config's import graph.`)
    }
  }

  /** 监听输入是一份只读快照，调用方不需要理解加载器的恢复状态 */
  get watchInput(): ConfigWatchInput {
    return this.currentWatchInput
  }

  /**
   * 按来源顺序加载首个有效配置
   *
   * @description 内置 parser 使用转换后的文本；自定义 parser 接收原入口路径并自行读取
   * @returns 配置对象、已加载入口及参与监听的依赖路径；没有有效配置时配置对象为空
   * @throws 配置读取、转换、解析或执行失败时抛出错误
   */
  async load(sources: LoadConfigSource<PagesConfig>[]): Promise<LoadedPagesConfig> {
    this.recoveryCandidates.clear()
    this.recoveryDirectories.clear()
    const dependencies = new Set<string>()
    const attemptedPaths = new Set<string>()
    const normalize = (filepath: string): string => normalizeConfigPath(filepath, this.root)
    const adapted = sources.map((source): LoadConfigSource<PagesConfig> => ({
      ...source,
      // 在 parser 内传递转换文本，使入口路径保持不变且无需写入源码目录
      transform: undefined,
      parser: async (filepath) => {
        attemptedPaths.add(normalize(filepath))
        if (typeof source.parser === 'function') {
          if (source.transform)
            await source.transform(await readFile(filepath, 'utf8'), filepath)
          return source.parser(filepath)
        }
        let code = await readFile(filepath, 'utf8')
        if (source.transform)
          code = await source.transform(code, filepath) || code
        const parser = source.parser || 'auto'
        if (parser === 'json' || path.extname(filepath) === '.json')
          return JSON.parse(stripBom(code))
        if (parser === 'auto') {
          try {
            return JSON.parse(stripBom(code))
          }
          catch {}
        }
        return this.loadScript(filepath, code, dependencies, attemptedPaths)
      },
    }))

    try {
      const result = await loadConfig<PagesConfig>({ cwd: this.root, sources: adapted, defaults: {} })
      this.recoveryPaths.clear()
      this.recoveryCandidates.clear()
      this.recoveryDirectories.clear()
      for (const source of result.sources)
        this.knownSources.add(normalize(source))
      // 已加载入口删除后仍监视它的重建；不保留已移出导入图的普通依赖
      for (const source of this.knownSources) {
        if (!existsSync(source))
          dependencies.add(source)
      }
      const sources = result.sources.map(normalize)
      const dependencyPaths = [...dependencies]
      this.lastSources = sources
      this.lastDependencies = dependencyPaths
      this.currentWatchInput = {
        sources,
        dependencies: dependencyPaths,
        recoveryCandidates: [],
        recoveryDirectories: [],
      }
      return {
        config: result.config,
        sources,
        dependencies: dependencyPaths,
      }
    }
    catch (error) {
      // 每次失败都按本轮的尝试重建，避免多次失败把上一次的范围累积下来
      this.recoveryPaths.clear()
      for (const filepath of attemptedPaths)
        this.recoveryPaths.add(filepath)
      this.currentWatchInput = {
        sources: [...this.lastSources],
        dependencies: [...new Set([...this.lastDependencies, ...this.recoveryPaths])],
        recoveryCandidates: [...this.recoveryCandidates],
        recoveryDirectories: [...this.recoveryDirectories],
      }
      throw error
    }
  }

  /**
   * 打包并执行脚本配置，返回其导出的配置对象
   *
   * @param source 原配置入口路径，作为入口导入和运行时相对路径的解析基准
   * @param code 经过可选 transform 处理的入口文本，依赖模块按各自路径读取
   * @param dependencies 接收成功打包涉及的本地依赖路径
   * @param attempted 接收本轮尝试读取的本地源路径，供执行失败后恢复监听
   */
  private async loadScript(source: string, code: string, dependencies: Set<string>, attempted: Set<string>): Promise<PagesConfig> {
    const sourcePath = normalizeConfigPath(source, this.root)
    // esbuild 的钩子拿不到 this，成员问题先收集，打包结束后统一提示
    const metaWarnings: ConfigMetaWarning[] = []
    const importDirectories = new Set<string>()
    const recoveryCandidates = new Set<string>()
    const root = this.root
    // 每轮打包使用独占目录，隔离并发加载的辅助模块和执行产物
    const cacheDirectory = this.artifactDirectory
    mkdirSync(cacheDirectory, { recursive: true })
    const bundleDirectory = await mkdtemp(path.join(cacheDirectory, 'load-'))
    const runtime = normalizePath(path.join(bundleDirectory, 'runtime.mjs'))
    // 合成入口只用于通过 bundle-require 的扩展名校验，onResolve 会映射回原文件，无需落盘
    const entry = scriptExtensions.test(source) ? source : path.join(bundleDirectory, 'entry.ts')
    try {
      // runtime.mjs 提供公共解析助手，原文件位置由每个源模块注入的调用参数提供
      await writeFile(runtime, configRuntimeSource(this.env))
      // bundle-require 将配置和辅助代码打包到 config.mjs，再交给 Node 执行
      const { mod, dependencies: inputs } = await bundleRequire<Record<string, unknown>>({
        filepath: entry,
        cwd: this.root,
        format: 'esm',
        tsconfig: false,
        // 由加载器统一清理独占目录，避免依赖的单文件删除错误覆盖求值结果
        preserveTemporaryFile: true,
        getOutputFile: () => path.join(bundleDirectory, 'config.mjs'),
        // 外部包先按原导入位置解析，避免临时产物改变 node_modules 查找起点
        notExternal: [/.*/],
        esbuildOptions: {
          logLevel: 'silent',
          target: 'node22',
          conditions: [],
          mainFields: ['main'],
          // 与 unconfig/jiti 的行为保持一致：省略扩展名的导入也要能命中
          // .mjs/.cjs/.mts/.cts，目录导入同样按这些后缀找 index
          resolveExtensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
          // ESM 产物中的本地 CJS 依赖仍可调用原生 require
          banner: { js: `import { createRequire as __uniPagesCreateRequire } from 'node:module'; const require = __uniPagesCreateRequire(import.meta.url);` },
          plugins: [{
            name: 'uni-pages-config-inputs',
            setup(build) {
              build.onResolve({ filter: /.*/ }, async (args) => {
                if (args.kind === 'entry-point')
                  return { path: path.resolve(sourcePath) }
                if (args.pluginData?.resolvingPackage)
                  return
                if (/^(?:node:|file:|data:)/.test(args.path))
                  return { path: args.path, external: true }
                if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
                  const directory = normalizeConfigPath(path.resolve(args.resolveDir, args.path), root)
                  if (!isNodeModulesPath(directory) && !isConfigLoaderArtifact(directory, cacheDirectory)) {
                    // 导入目标可能是尚未创建的目录；仅保留其内部范围，不放宽到父目录
                    importDirectories.add(directory)
                    for (const candidate of recoveryCandidatesFor(args.path, args.resolveDir))
                      recoveryCandidates.add(normalizeConfigPath(candidate, root))
                  }
                  return
                }
                const result = await build.resolve(args.path, {
                  importer: args.importer,
                  resolveDir: args.resolveDir,
                  kind: args.kind,
                  namespace: args.namespace,
                  pluginData: { resolvingPackage: true },
                })
                if (result.errors.length)
                  return { errors: result.errors, warnings: result.warnings }
                // workspace 源码需要重新求值；已安装 TS/JSON 包也需转译，但不参与监听
                if (path.isAbsolute(result.path) && (!isNodeModulesPath(result.path) || /\.(?:[cm]?tsx?|json)$/.test(result.path)))
                  return { path: result.path }
                const isRequire = args.kind === 'require-call' || args.kind === 'require-resolve'
                return {
                  path: !isRequire && path.isAbsolute(result.path) ? pathToFileURL(result.path).href : result.path,
                  external: true,
                }
              })
              // 在执行前保留输入文件；新依赖执行抛错时，修复该文件也能触发重载
              build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
                const file = normalizeConfigPath(args.path, root)
                if (file === runtime)
                  return { contents: await readFile(runtime, 'utf8'), loader: 'js' }
                if (!isNodeModulesPath(file) && !isConfigLoaderArtifact(file, cacheDirectory))
                  attempted.add(file)
                if (file !== sourcePath && !scriptExtensions.test(file))
                  return
                const contents = file === sourcePath ? code : await readFile(args.path, 'utf8')
                const transformed = await transformConfigSource(contents, path.resolve(file), runtime)
                metaWarnings.push(...transformed.warnings)
                return { contents: transformed.code, loader: 'js' }
              })
            },
          }],
        },
      })
      for (const input of inputs) {
        const file = normalizeConfigPath(input, root)
        if (!isNodeModulesPath(file) && !isConfigLoaderArtifact(file, cacheDirectory))
          dependencies.add(file)
      }
      // 目录导入的入口由 package.json 的 main/exports 决定；清单本身
      // 也是依赖，修改入口指向后要重新加载
      for (const directory of importDirectories) {
        const manifest = normalizeConfigPath(path.join(directory, 'package.json'), root)
        if (existsSync(manifest) && !isNodeModulesPath(manifest) && !isConfigLoaderArtifact(manifest, cacheDirectory))
          dependencies.add(manifest)
      }
      // 对齐 jiti 的 default:true 解包，再处理 unconfig 的嵌套 default 对象
      return unwrapConfig(mod.default ?? mod) as PagesConfig
    }
    catch (error) {
      // 打包后的栈全部指向临时产物，补一句说明它由哪些源码生成，避免把
      // config.mjs 当成用户源码去读。编译错误自带原始位置，不重复提示
      if (error instanceof Error && String(error.stack).includes(bundleDirectory))
        error.message += `\n[vite-plugin-uni-pages] The stack above points into the bundled config generated from ${normalizePath(path.relative(this.root, sourcePath))} and the modules it imports.`
      if (Array.isArray((error as { errors?: unknown })?.errors)) {
        // 编译失败时保留缺失文件的精确候选
        for (const candidate of recoveryCandidates) {
          if (!existsSync(candidate))
            this.recoveryCandidates.add(candidate)
        }
        // package.json 的 main 可能指向非 index 文件，目录内补建清单或入口也需触发恢复
        for (const directory of importDirectories)
          this.recoveryDirectories.add(directory)
      }
      throw error
    }
    finally {
      // 提示放在 finally：加载失败时同样要说明哪个文件用了拿不到的成员
      this.reportMetaWarnings(metaWarnings)
      // 清理失败不能改变这次加载的结果，也不能覆盖原始错误；残留目录仍被
      // 产物身份过滤排除，不会进入输入索引或监听
      try {
        await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      }
      catch (error) {
        debug.error('Failed to remove config loader directory %s:', bundleDirectory, error)
      }
    }
  }
}

function unwrapConfig(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !('default' in value) || value.default === null || typeof value.default !== 'object')
    return value
  const result = value.default as Record<string, unknown>
  for (const [key, item] of Object.entries(value)) {
    if (key === 'default' || key in result || item === result)
      continue
    try {
      Object.defineProperty(result, key, { configurable: true, enumerable: true, get: () => (value as Record<string, unknown>)[key] })
    }
    catch {}
  }
  return result
}
