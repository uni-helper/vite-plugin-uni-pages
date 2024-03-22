declare module 'virtual:uni-pages' {
  export const pages: import('.').PageMetaDatum[]
  export const subPackages: import('.').SubPackage[]
}

declare module globalThis {
  export const definePage: import('.').DefinePage
}
