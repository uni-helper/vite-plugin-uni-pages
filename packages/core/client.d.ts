/// <reference path="./global.d.ts" />

declare module 'virtual:uni-pages' {
  import type { PageMetaDatum, SubPackage } from '@uni-helper/uni-pages-types'

  export const pages: PageMetaDatum[]
  export const subPackages: SubPackage[]
}
