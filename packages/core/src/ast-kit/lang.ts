import { extname } from 'node:path'

export const REGEX_DTS: RegExp = /\.d\.[cm]?ts(\?.*)?$/
export const REGEX_LANG_TS: RegExp = /^[cm]?tsx?$/
export const REGEX_LANG_JSX: RegExp = /^[cm]?[jt]sx$/

/**
 * Returns the language (extension name) of a given filename.
 * @param filename - The name of the file.
 * @returns The language of the file.
 */
export function getLang(filename: string): string {
  if (isDts(filename))
    return 'dts'
  return extname(filename).replace(/^\./, '').replace(/\?.*$/, '')
}

/**
 * Checks if a filename represents a TypeScript declaration file (.d.ts).
 * @param filename - The name of the file to check.
 * @returns A boolean value indicating whether the filename is a TypeScript declaration file.
 */
export function isDts(filename: string): boolean {
  return REGEX_DTS.test(filename)
}

/**
 * Checks if the given language (ts, mts, cjs, dts, tsx...) is TypeScript.
 * @param lang - The language to check.
 * @returns A boolean indicating whether the language is TypeScript.
 */
export function isTs(lang?: string): boolean {
  return !!lang && (lang === 'dts' || REGEX_LANG_TS.test(lang))
}
