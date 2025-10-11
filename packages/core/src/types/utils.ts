export type MaybePromise<T> = T | Promise<T>
export type MaybeCallable<T> = T | (() => T)
export type MaybePromiseCallable<T> = T | (() => T) | (() => Promise<T>)

export type ExcludeIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K]
}

export type KnownKeys<T> = keyof ExcludeIndexSignature<T>

export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T
