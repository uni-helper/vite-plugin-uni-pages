/**
 * 平台条件化页面元信息 DSL
 *
 * 深模块，承载从 @uni-ku/pages-json 吸收的 `define().ifdef().ifndef()`
 * 表达式：一个由注入到函数式 definePage 宏的 `define` 工厂构建的可链式
 * 定义对象，以及它的平台作用域解析。插件在宏求值之后立即为当前平台
 * 解析定义，下游（变更检测、pages.json 合并）因此始终只处理普通对象。
 */

/** 定义上记录的单个条件分支 */
interface ConditionalBranch {
  /** 平台在（ifdef）或不在（ifndef）`platforms` 列表中时分支是否生效 */
  condition: 'ifdef' | 'ifndef'
  /** 该分支限定的平台标识列表 */
  platforms: string[]
  /** 分支生效时深合并进基础元信息的部分元信息 */
  partial: Record<string, any>
}

/** 判断一个值是否为普通对象（非 null、非数组） */
function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * 将 `partial` 深合并进 `base`，不改动任何一侧
 *
 * 对象递归合并；数组与原始值整体替换，与 @uni-ku/pages-json 的语义
 * 一致。
 */
function deepMerge(base: Record<string, any>, partial: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...base }
  for (const key of Object.keys(partial)) {
    const baseVal = result[key]
    const partialVal = partial[key]
    result[key] = isPlainObject(baseVal) && isPlainObject(partialVal)
      ? deepMerge(baseVal, partialVal)
      : partialVal
  }
  return result
}

function toPlatforms(platform: string | string[]): string[] {
  return Array.isArray(platform) ? platform : [platform]
}

/** uni-app 生态中同一浏览器目标的平台标识别名 */
const H5_ALIASES = ['h5', 'web']

/**
 * `platform` 是否被 `platforms` 列表覆盖
 *
 * uni-env 的 `isH5`/`isWeb` 同时接受 `h5` 和 `web`（较新的 uni-app H5
 * 构建会设置 UNI_PLATFORM=web），因此列表中任一别名都视为覆盖两者。
 */
function platformMatches(platforms: string[], platform: string): boolean {
  if (platforms.includes(platform))
    return true
  return H5_ALIASES.includes(platform) && platforms.some(p => H5_ALIASES.includes(p))
}

/**
 * 可链式的平台条件化页面元信息定义
 *
 * 通过注入到函数式 definePage 宏的 `define` 工厂创建。匹配的分支按
 * 声明顺序依次应用，后声明的分支会覆盖先声明分支上的同名键。
 */
export class DefineConditional {
  /** 所有平台共用的基础元信息 */
  private readonly base: Record<string, any>
  /** 按声明顺序记录的条件分支 */
  private readonly branches: ConditionalBranch[] = []

  constructor(base: Record<string, any>) {
    this.base = base
  }

  /** 仅在给定平台应用 `partial` */
  ifdef(platform: string | string[], partial: Record<string, any>): this {
    this.branches.push({ condition: 'ifdef', platforms: toPlatforms(platform), partial })
    return this
  }

  /** 在除给定平台之外的所有平台应用 `partial` */
  ifndef(platform: string | string[], partial: Record<string, any>): this {
    this.branches.push({ condition: 'ifndef', platforms: toPlatforms(platform), partial })
    return this
  }

  /**
   * 解析为单个平台的普通元信息：从基础元信息出发，按声明顺序深合并
   * 每个匹配的分支。分支平台列表中 `h5` 与 `web` 可互换（见
   * platformMatches）。
   */
  resolve(platform: string): Record<string, any> {
    let result = this.base
    for (const branch of this.branches) {
      const matched = branch.condition === 'ifdef'
        ? platformMatches(branch.platforms, platform)
        : !platformMatches(branch.platforms, platform)
      if (matched)
        result = deepMerge(result, branch.partial)
    }
    return result
  }
}

/** 判断宏求值结果是否为条件化定义 */
export function isConditional(obj: unknown): obj is DefineConditional {
  return obj instanceof DefineConditional
}

/**
 * 将条件化定义解析为单个平台的普通元信息
 *
 * {@link DefineConditional.resolve} 的轻量函数封装，调用方无需导入
 * 类本身。
 */
export function resolveConditional(cond: DefineConditional, platform: string): Record<string, any> {
  return cond.resolve(platform)
}
