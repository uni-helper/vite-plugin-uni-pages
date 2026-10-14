import type { PagesConfig } from '@uni-helper/uni-pages-types'
import type { LoadConfigSource } from 'unconfig'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleRequire } from 'bundle-require'
import { loadConfig } from 'unconfig'
import { normalizePath } from 'vite'

const scriptExtensions = /\.[cm]?[jt]sx?$/
/** 目录恢复监听接受的文件类型；已知配置入口与依赖不受此限制 */
export const configFileExtensions = /\.(?:[cm]?[jt]sx?|json)$/
/** 省略扩展名时 esbuild 会依次尝试的后缀，用于列举恢复候选文件 */
const candidateExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.json']
/** TS 约定里 `./x.js` 指向的就是 `./x.ts`，恢复候选也得列上 */
const typescriptAliases: Record<string, string[]> = { '.cjs': ['.cts'], '.js': ['.ts', '.tsx'], '.mjs': ['.mts'] }

function isNodeModulesPath(filepath: string): boolean {
  return normalizePath(filepath).split('/').includes('node_modules')
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
 * 判断文件名是否为配置加载过程的临时产物
 *
 * `bundle-require` 在配置入口旁写 `*.bundled_<id>.mjs` 后立刻删除，unconfig
 * 会写 `__unconfig_*`。这些文件存在时间极短，监听它们有两个后果：
 * 事件会被误当成配置变更；Windows 上 chokidar 对已删除的文件调 `fs.watch`
 * 会抛 EPERM，作为未处理的拒绝直接让进程退出。因此监听路径和事件过滤
 * 都要排除它们。
 */
export function isConfigLoaderArtifact(basename: string): boolean {
  return basename.includes('.bundled_') || basename.startsWith('__unconfig_')
}

/** 配置加载结果及本次成功求值涉及的文件 */
interface LoadedPagesConfig {
  config: PagesConfig
  sources: string[]
  dependencies: string[]
}

/**
 * 保留 unconfig 的发现与回调契约，以打包后的新模块重新求值本地依赖
 *
 * @description 自定义 parser 仍由调用方负责加载；失败路径只用于恢复监听，不替换上次成功配置
 */
export class PagesConfigLoader {
  /** 装载失败时仍需监听重建的入口与已尝试路径 */
  readonly recoveryPaths = new Set<string>()
  /** 本次失败中具体缺哪个文件；优先按它判断，命中时不看目录 */
  readonly recoveryCandidates = new Set<string>()
  /** 目录导入的恢复范围，覆盖 package.json 和自定义入口 */
  readonly recoveryDirectories = new Set<string>()
  private readonly knownSources = new Set<string>()

  constructor(private readonly root: string) {}

  async load(sources: LoadConfigSource<PagesConfig>[]): Promise<LoadedPagesConfig> {
    this.recoveryCandidates.clear()
    this.recoveryDirectories.clear()
    const dependencies = new Set<string>()
    const attemptedPaths = new Set<string>()
    const normalize = (filepath: string): string => normalizeConfigPath(filepath, this.root)
    const adapted = sources.map((source): LoadConfigSource<PagesConfig> => {
      if (typeof source.parser === 'function')
        return source

      const transformed = new Set<string>()
      return {
        ...source,
        transform: source.transform
          ? async (code, filepath) => {
            const result = await source.transform!(code, filepath)
            if (result)
              transformed.add(filepath)
            return result
          }
          : undefined,
        parser: async (filepath) => {
          attemptedPaths.add(normalize(filepath))
          const target = transformed.has(filepath)
            ? path.join(path.dirname(filepath), `__unconfig_${path.basename(filepath)}`)
            : filepath
          const parser = source.parser || 'auto'
          if (parser === 'json')
            return JSON.parse(await readFile(target, 'utf8'))
          if (parser === 'auto') {
            try {
              return JSON.parse(await readFile(target, 'utf8'))
            }
            catch {}
          }
          // 未知扩展名继续交给 unconfig，保留调用方自定义扩展的原有加载方式
          if (!scriptExtensions.test(target)) {
            const result = await loadConfig<PagesConfig>({ sources: [{ files: target, parser: 'import' }], defaults: {} })
            return result.config
          }
          return this.loadScript(target, filepath, dependencies, attemptedPaths)
        },
      }
    })

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
      return {
        config: result.config,
        sources: result.sources.map(normalize),
        dependencies: [...dependencies],
      }
    }
    catch (error) {
      // 每次失败都按本轮的尝试重建，避免多次失败把上一次的范围累积下来
      this.recoveryPaths.clear()
      for (const filepath of attemptedPaths)
        this.recoveryPaths.add(filepath)
      throw error
    }
  }

  private async loadScript(target: string, source: string, dependencies: Set<string>, attempted: Set<string>): Promise<PagesConfig> {
    const targetPath = normalizeConfigPath(target, this.root)
    const sourcePath = normalizeConfigPath(source, this.root)
    const importDirectories = new Set<string>()
    const recoveryCandidates = new Set<string>()
    const root = this.root
    // 临时产物必须写在监听范围之外
    //
    // 默认位置是配置入口旁边，chokidar 读到它、准备监听时文件已经删了，
    // Windows 上 `fs.watch` 抛 EPERM；这个异常从异步目录遍历里冒出来，
    // 没人接，进程直接退出。node_modules 各平台的监听器都跳过，
    // 放这里既避开了监听，又不改变 node_modules 查找起点。
    const bundleDirectory = path.join(this.root, 'node_modules/.cache/uni-pages')
    const outputFile = (file: string): string => {
      mkdirSync(bundleDirectory, { recursive: true })
      const name = `${path.basename(file).replace(/[^\w.-]/g, '_')}.bundled_${Math.random().toString(36).slice(2)}.mjs`
      return path.join(bundleDirectory, name)
    }
    const toSourcePath = (file: string): string => {
      const absolute = normalizeConfigPath(file, this.root)
      return absolute === targetPath ? sourcePath : absolute
    }
    try {
      const { mod, dependencies: inputs } = await bundleRequire<Record<string, unknown>>({
        filepath: target,
        cwd: this.root,
        format: 'esm',
        tsconfig: false,
        preserveTemporaryFile: false,
        getOutputFile: outputFile,
        // 外部包先按原导入位置解析，避免临时产物改变 node_modules 查找起点
        notExternal: [/.*/],
        esbuildOptions: {
          logLevel: 'silent',
          target: 'node22',
          conditions: [],
          mainFields: ['main'],
          // ESM 产物中的本地 CJS 依赖仍可调用原生 require
          banner: { js: `import { createRequire as __uniPagesCreateRequire } from 'node:module'; const require = __uniPagesCreateRequire(import.meta.url);` },
          plugins: [{
            name: 'uni-pages-config-inputs',
            setup(build) {
              build.onResolve({ filter: /.*/ }, async (args) => {
                if (args.kind === 'entry-point' || args.pluginData?.resolvingPackage)
                  return
                if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
                  const directory = normalizeConfigPath(path.resolve(args.resolveDir, args.path), root)
                  if (!isNodeModulesPath(directory)) {
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
              build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
                const file = toSourcePath(args.path)
                if (!isNodeModulesPath(file))
                  attempted.add(file)
              })
            },
          }],
        },
      })
      for (const input of inputs) {
        const file = toSourcePath(input)
        if (!isNodeModulesPath(file))
          dependencies.add(file)
      }
      // 对齐 jiti 的 default:true 解包，再处理 unconfig 的嵌套 default 对象
      return unwrapConfig(mod.default ?? mod) as PagesConfig
    }
    catch (error) {
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
