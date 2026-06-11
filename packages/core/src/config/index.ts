import type { UserPagesConfig } from '@uni-helper/uni-pages-types'

export type * from '@uni-helper/uni-pages-types'

/**
 * Define uni-pages configuration
 * Used in pages.config.ts configuration file to provide type hints and validation
 *
 * @param config - Page configuration object
 * @returns Configuration object
 */
export function defineUniPages(config: UserPagesConfig) {
  return config
}
