import fs from 'fs'
import JSON5 from 'json5'
import { parse as YAMLParser } from 'yaml'
import { parse as VueParser } from '@vue/compiler-sfc'
import type { SFCBlock, SFCDescriptor } from '@vue/compiler-sfc'
import { debug } from './utils'
import type { CustomBlock, ResolvedOptions } from './types'

export async function parseSFC(code: string): Promise<SFCDescriptor> {
  try {
    return (
      VueParser(code, {
        pad: 'space',
      }).descriptor
      // for @vue/compiler-sfc ^2.7
      || (VueParser as any)({
        source: code,
      })
    )
  }
  catch {
    throw new Error(
      '[vite-plugin-uni-pages] Vue3\'s "@vue/compiler-sfc" is required.',
    )
  }
}

export function parseCustomBlock(
  block: SFCBlock,
  filePath: string,
  options: ResolvedOptions,
): any {
  const lang = block.lang ?? options.routeBlockLang

  debug.routeBlock(`use ${lang} parser`)

  if (lang === 'json5') {
    try {
      return JSON5.parse(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid JSON5 format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  else if (lang === 'json') {
    try {
      return JSON.parse(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid JSON format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  else if (lang === 'yaml' || lang === 'yml') {
    try {
      return YAMLParser(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid YAML format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
}

export async function getRouteBlock(path: string, options: ResolvedOptions) {
  const content = fs.readFileSync(path, 'utf8')

  const parsedSFC = await parseSFC(content)
  const blockStr = parsedSFC?.customBlocks.find(b => b.type === 'route')

  if (!blockStr)
    return

  const result = parseCustomBlock(blockStr, path, options) as CustomBlock

  return result
}
