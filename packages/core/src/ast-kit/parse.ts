import type { ParseResult, ParserOptions, ParserPlugin } from '@babel/parser'
import type * as t from '@babel/types'
import { parse } from '@babel/parser'
import { isTs, REGEX_LANG_JSX } from './lang'

export const parseCache: Map<string, ParseResult<t.File>> = new Map<
  string,
  ParseResult<t.File>
>()

/**
 * Parses the given code using Babel parser.
 *
 * @param code - The code to parse.
 * @param lang - The language of the code (optional).
 * @param options - The parser options (optional).
 * @param options.cache - Whether to cache the result (optional).
 * @returns The parse result, including the program, errors, and comments.
 */
export function babelParse(
  code: string,
  lang?: string,
  { cache, ...options }: ParserOptions & { cache?: boolean } = {},
): t.Program & Omit<ParseResult<t.File>, 'type' | 'program'> {
  let result: ParseResult<t.File> | undefined
  if (cache)
    result = parseCache.get(code)

  if (!result) {
    result = parse(code, getBabelParserOptions(lang, options))
    if (cache)
      parseCache.set(code, result)
  }

  const { program, type, ...rest } = result
  return { ...program, ...rest }
}

/**
 * Gets the Babel parser options for the given language.
 * @param lang - The language of the code (optional).
 * @param options - The parser options (optional).
 * @returns The Babel parser options for the given language.
 */
export function getBabelParserOptions(
  lang?: string,
  options: ParserOptions = {},
): ParserOptions {
  const plugins: ParserPlugin[] = [...(options.plugins || [])]
  if (isTs(lang)) {
    if (!hasPlugin(plugins, 'typescript')) {
      plugins.push(
        lang === 'dts' ? ['typescript', { dts: true }] : 'typescript',
      )
    }

    if (
      !hasPlugin(plugins, 'decorators')
      && !hasPlugin(plugins, 'decorators-legacy')
    ) {
      plugins.push('decorators-legacy')
    }

    if (
      !hasPlugin(plugins, 'importAttributes')
      && !hasPlugin(plugins, 'importAssertions')
      && !hasPlugin(plugins, 'deprecatedImportAssert')
    ) {
      plugins.push('importAttributes', 'deprecatedImportAssert')
    }

    if (!hasPlugin(plugins, 'explicitResourceManagement')) {
      plugins.push('explicitResourceManagement')
    }

    if (REGEX_LANG_JSX.test(lang!) && !hasPlugin(plugins, 'jsx')) {
      plugins.push('jsx')
    }
  }
  else if (!hasPlugin(plugins, 'jsx')) {
    plugins.push('jsx')
  }
  return {
    sourceType: 'module',
    ...options,
    plugins,
  }
}

function hasPlugin(
  plugins: ParserPlugin[],
  plugin: Exclude<ParserPlugin, any[]>,
) {
  return plugins.some(p => (Array.isArray(p) ? p[0] : p) === plugin)
}
