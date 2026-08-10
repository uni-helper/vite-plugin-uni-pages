/**
 * Platform-conditional page metadata DSL
 *
 * Deep module owning the `define().ifdef().ifndef()` expression absorbed
 * from @uni-ku/pages-json: a chainable definition object built by the
 * `define` factory injected into function-form definePage macros, plus its
 * platform-scoped resolution. The plugin resolves definitions for the
 * current platform right after macro evaluation, so everything downstream
 * (change detection, pages.json merging) keeps handling plain objects.
 */

/** A single conditional branch recorded on a definition */
interface ConditionalBranch {
  /** Whether the branch applies when the platform is (ifdef) or is not (ifndef) in `platforms` */
  condition: 'ifdef' | 'ifndef'
  /** Platform identifiers this branch is scoped to */
  platforms: string[]
  /** Partial metadata deep-merged into the base when the branch applies */
  partial: Record<string, any>
}

/** Whether a value is a plain object (not null, not an array) */
function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Deep-merge `partial` into `base` without mutating either side
 *
 * Objects merge recursively; arrays and primitive values are replaced
 * wholesale, matching @uni-ku/pages-json semantics.
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

/** Platform identifiers for the same browser target in the uni-app ecosystem */
const H5_ALIASES = ['h5', 'web']

/**
 * Whether `platform` is covered by the `platforms` list
 *
 * uni-env's `isH5`/`isWeb` both accept `h5` and `web` (newer uni-app H5
 * builds set UNI_PLATFORM=web), so listing either alias covers both.
 */
function platformMatches(platforms: string[], platform: string): boolean {
  if (platforms.includes(platform))
    return true
  return H5_ALIASES.includes(platform) && platforms.some(p => H5_ALIASES.includes(p))
}

/**
 * Chainable platform-conditional page metadata definition
 *
 * Created through the `define` factory injected into function-form
 * definePage macros. Matching branches are applied in declaration order,
 * so a later branch overrides an earlier one on the same keys.
 */
export class DefineConditional {
  /** Base metadata every platform starts from */
  private readonly base: Record<string, any>
  /** Conditional branches in declaration order */
  private readonly branches: ConditionalBranch[] = []

  constructor(base: Record<string, any>) {
    this.base = base
  }

  /** Apply `partial` only on the given platform(s) */
  ifdef(platform: string | string[], partial: Record<string, any>): this {
    this.branches.push({ condition: 'ifdef', platforms: toPlatforms(platform), partial })
    return this
  }

  /** Apply `partial` on every platform except the given one(s) */
  ifndef(platform: string | string[], partial: Record<string, any>): this {
    this.branches.push({ condition: 'ifndef', platforms: toPlatforms(platform), partial })
    return this
  }

  /**
   * Resolve into plain metadata for one platform: start from the base and
   * deep-merge every matching branch in declaration order. `h5` and `web`
   * are interchangeable in branch platform lists (see platformMatches).
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

/** Whether a macro evaluation result is a conditional definition */
export function isConditional(obj: unknown): obj is DefineConditional {
  return obj instanceof DefineConditional
}

/**
 * Resolve a conditional definition into plain metadata for one platform
 *
 * Thin function facade over {@link DefineConditional.resolve} so callers
 * do not need to import the class itself.
 */
export function resolveConditional(cond: DefineConditional, platform: string): Record<string, any> {
  return cond.resolve(platform)
}
