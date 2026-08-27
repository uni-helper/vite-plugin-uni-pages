/**
 * 按平台写不同页面配置的小工具
 *
 * 用法来自 @uni-ku/pages-json：define().ifdef().ifndef()。用户在
 * 函数式 definePage 里调用 define() 拿到可链式写的定义对象，先写
 * 所有平台共用的配置，再按平台加不同的部分。插件在宏求值完就立刻
 * 按当前平台算出最终结果，后面的步骤只会看到普通对象。
 */

/** 记录在定义上的单个条件分支 */
interface ConditionalBranch {
  /**
   * 条件类型：'ifdef' 表示平台在列表里时这个分支生效；
   * 'ifndef' 表示平台不在列表里时生效
   */
  condition: 'ifdef' | 'ifndef'
  /** 这个分支限定的平台列表 */
  platforms: string[]
  /** 分支生效时合并进去的那部分配置 */
  partial: Record<string, any>
}

/** 判断一个值是否为普通对象（非 null、非数组） */
function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * 把 `partial` 合并进 `base`，两边都不改动
 *
 * 对象一层层往里合并；数组和普通值直接整个替换。规则和
 * @uni-ku/pages-json 保持一致。
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
 * `platform` 是否匹配 `platforms` 列表
 *
 * uni-env 的 `isH5`/`isWeb` 同时认 `h5` 和 `web` 两个写法（较新的
 * uni-app H5 构建设置的是 UNI_PLATFORM=web），所以列表里写了其中
 * 任何一个写法，都算匹配。
 */
function platformMatches(platforms: string[], platform: string): boolean {
  if (platforms.includes(platform))
    return true
  return H5_ALIASES.includes(platform) && platforms.some(p => H5_ALIASES.includes(p))
}

/**
 * 可以链式调用的"按平台写配置"对象
 *
 * 用户在函数式 definePage 里通过 define() 创建。分支按写的顺序生效，
 * 后写的同名键会盖掉先写的。
 */
export class DefineConditional {
  /** 所有平台共用的基础配置 */
  private readonly base: Record<string, any>
  /** 按写的顺序记下的条件分支 */
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
   * 算出某个平台最终用的普通配置：从基础配置开始，按写的顺序把每个
   * 匹配的分支合并进去。平台列表里 `h5` 和 `web` 互相通用（见
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

/** 判断宏求值的结果是不是一个条件定义 */
export function isConditional(obj: unknown): obj is DefineConditional {
  return obj instanceof DefineConditional
}

/**
 * 把条件定义算成某个平台的普通配置
 *
 * 简单包了一层 {@link DefineConditional.resolve}，调用方不用导入
 * 这个类。
 */
export function resolveConditional(cond: DefineConditional, platform: string): Record<string, any> {
  return cond.resolve(platform)
}
