declare module 'virtual:uni-pages' {
  import type { PageMetaDatum } from './src/types'
  import type { SubPackage } from './src/config/types/index'

  export const pages: PageMetaDatum[]
  export const subPackages: SubPackage[]
}

declare namespace globalThis{
  export const definePage: import('.').DefinePage
}
