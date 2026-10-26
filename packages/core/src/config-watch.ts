import path from 'node:path'
import { normalizePath } from 'vite'
import { configFileExtensions, configWatchDirectory, isConfigLoaderArtifact, normalizeConfigPath } from './config-loader'

/**
 * 配置监听计划：一次配置加载需要监听的输入，以及用于恢复的目录范围。
 *
 * 加载器只负责说明本次加载涉及哪些文件；这里把「源文件、依赖、缺失候选、
 * 恢复目录」换算成最终的文件集合与注册路径。事件判定也在这里完成，避免
 * PageContext 再复制一份加载器的恢复状态。
 */
export interface ConfigWatchPlan {
  /** 当前依赖集合，按归一化绝对路径保存；事件只有命中这里才算配置变更 */
  files: readonly string[]
  /** 目录导入失败时的恢复范围，允许补建入口或 package.json */
  directories: readonly string[]
  /** 需要注册到 watcher 的路径：文件、现存父目录和恢复目录入口 */
  paths: readonly string[]
}

export interface ConfigWatchPlanInput {
  root: string
  artifactDirectory: string
  sourcePaths: readonly string[]
  dependencyPaths: readonly string[]
  recoveryCandidates?: readonly string[]
  recoveryDirectories?: readonly string[]
}

function isWithin(directory: string, file: string): boolean {
  const normalized = directory.replace(/\/$/, '')
  return file === normalized || file.startsWith(`${normalized}/`)
}

/** 把一次加载的输入归一化为可注册、可匹配的监听计划 */
export function buildConfigWatchPlan(input: ConfigWatchPlanInput): ConfigWatchPlan {
  const files = [...new Set(
    [...input.sourcePaths, ...input.dependencyPaths, ...(input.recoveryCandidates ?? [])]
      .map(file => normalizeConfigPath(file, input.root))
      .filter(file => !isConfigLoaderArtifact(file, input.artifactDirectory)),
  )]
  const directories = [...new Set(
    (input.recoveryDirectories ?? []).map(dir => normalizeConfigPath(dir, input.root)),
  )]
  const paths = [...new Set([
    ...files,
    ...files.map(configWatchDirectory),
    ...directories.map(dir => configWatchDirectory(path.join(dir, '_'))),
  ])]

  return { files, directories, paths }
}

/**
 * 配置事件判定与监听集合的当前视图。
 *
 * 监听器只新增路径、从不退回（chokidar 对文件 unwatch 会拆掉父目录监听），
 * 所以真正决定事件是否触发的始终是最近一次 `update` 的依赖集合；
 * `expanded` 用来在依赖集合扩大后补跑一轮生成。
 */
export class ConfigWatchIndex {
  private plan: ConfigWatchPlan = { files: [], directories: [], paths: [] }
  private files = new Set<string>()
  private initialized = false
  private expanded = false

  constructor(
    private readonly root: string,
    private readonly artifactDirectory: string,
  ) {}

  update(plan: ConfigWatchPlan): void {
    const nextFiles = new Set(plan.files)
    if (this.initialized && [...nextFiles].some(file => !this.files.has(file)))
      this.expanded = true
    this.plan = plan
    this.files = nextFiles
    this.initialized = true
  }

  /**
   * 返回事件对应的归一化配置路径；不是当前配置输入时返回 undefined。
   *
   * 直接命中已知依赖时保留事件路径，避免为了识别符号链接别名而额外查
   * 文件系统；未命中时才按真实路径归一化，覆盖别名和冗余路径段。
   */
  match(filepath: string, excluded: readonly string[]): string | undefined {
    const eventPath = normalizePath(path.resolve(this.root, normalizePath(filepath)))
    if (excluded.includes(eventPath) || isConfigLoaderArtifact(eventPath, this.artifactDirectory))
      return

    const known = this.files.has(eventPath)
    const absolute = known ? eventPath : normalizeConfigPath(filepath, this.root)
    if (excluded.includes(absolute) || isConfigLoaderArtifact(absolute, this.artifactDirectory))
      return

    const mightBeConfig = configFileExtensions.test(path.basename(filepath))
    const isConfigPath = this.files.has(absolute)
      || (mightBeConfig && this.plan.directories.some(directory => isWithin(directory, absolute)))
    return isConfigPath ? absolute : undefined
  }

  /** 共享 watcher 已覆盖的根目录无需重复注册，也不能撤销 */
  watchPaths(sharedRoot?: string): readonly string[] {
    return this.plan.paths.filter(file => !sharedRoot || (file !== sharedRoot && !isWithin(sharedRoot, file)))
  }

  /** 依赖集合在上一次生成期间扩大时，消费一次补跑标记 */
  consumeExpanded(): boolean {
    const expanded = this.expanded
    this.expanded = false
    return expanded
  }
}
