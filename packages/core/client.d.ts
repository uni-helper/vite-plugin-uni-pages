declare module 'virtual:uni-pages' {
  import type { SubPackage } from './src/config/types/index'
  import type { PageMetaDatum } from './src/types'

  export const pages: PageMetaDatum[]
  export const subPackages: SubPackage[]
}

declare global {
  const definePage: import('.').DefinePage
}

export {}
