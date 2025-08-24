import JSON5 from 'json5'
import { parse as YAMLParser } from 'yaml'
import type { SFCBlock, SFCDescriptor } from '@vue/compiler-sfc'

import { parse as cjParse } from 'comment-json'
import type { CommentJSONValue } from 'comment-json'
import { debug } from './utils'
import type { CustomBlock, ResolvedOptions, RouteBlockLang } from './types'

export function parseCustomBlock(
  block: SFCBlock,
  filePath: string,
  routeBlockLang: RouteBlockLang,
): CustomBlock | undefined {
  const lang = block.lang ?? routeBlockLang
  const attr = {
    type: 'page',
    ...block.attrs,
  }
  let content: Record<string, any> | CommentJSONValue | undefined
  debug.routeBlock(`use ${lang} parser`)

  if (lang === 'json5') {
    try {
      content = JSON5.parse(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid JSON5 format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  else if (lang === 'jsonc') {
    try {
      content = cjParse(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid JSONC format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  else if (lang === 'json') {
    try {
      content = JSON.parse(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid JSON format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  else if (lang === 'yaml' || lang === 'yml') {
    try {
      content = YAMLParser(block.content)
    }
    catch (err: any) {
      throw new Error(
        `Invalid YAML format of <${block.type}> content in ${filePath}\n${err.message}`,
      )
    }
  }
  return {
    attr,
    content: content ?? {},
  }
}

export function getRouteSfcBlock(sfc?: SFCDescriptor): SFCBlock | undefined {
  return sfc?.customBlocks.find(b => b.type === 'route')
}

export function getRouteBlock(path: string, blockStr: SFCBlock | undefined, routeBlockLang: RouteBlockLang): CustomBlock | undefined {
  if (!blockStr)
    return
  return parseCustomBlock(blockStr, path, routeBlockLang)
}
