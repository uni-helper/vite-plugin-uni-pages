declare module 'virtual:uni-pages' {
  import type { Page, SubPackage } from '.'

  export const pages: Page[]
  export const subPackages: SubPackage[]
}

declare global {
  const definePage: import('.').DefinePage
}

export {}
