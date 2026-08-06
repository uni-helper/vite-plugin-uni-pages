/// <reference path="./global.d.ts" />

declare module 'virtual:uni-pages' {
  import type { InternalPages, SubPackages } from '@uni-helper/uni-pages-types'

  export const pages: InternalPages
  export const subPackages: SubPackages
}
