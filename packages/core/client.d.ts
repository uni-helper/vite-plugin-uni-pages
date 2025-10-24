declare module 'virtual:uni-pages' {
  import type { PagesJSON } from '.'

  export const pages: PagesJSON.Page[]
  export const subPackages: PagesJSON.SubPackage[]
}

declare global {
  const definePage: import('.').DefinePage
}

export {}
