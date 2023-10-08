import type { Service } from '@volar/language-service'
import { type LanguageService } from 'yaml-language-server'
import type * as json from 'vscode-json-languageservice'
import { type TextDocument } from 'vscode-languageserver-textdocument'
import { createJsonLs } from './jsonLs'
import { createYamlLs } from './yamlLs'
import { isYaml } from './utils'

export interface Provide {
  'json/jsonDocument': (document: TextDocument) => json.JSONDocument | undefined
  'json/languageService': () => json.LanguageService
  'yaml/languageService': () => LanguageService
}

export default (): Service<Provide> => (context): ReturnType<Service<Provide>> => {
  // https://github.com/microsoft/vscode/blob/09850876e652688fb142e2e19fd00fd38c0bc4ba/extensions/json-language-features/server/src/jsonServer.ts#L150
  const triggerCharacters = ['"', ':']

  if (!context)
    return { triggerCharacters } as any

  const jsonDocuments = new WeakMap<TextDocument, [number, json.JSONDocument]>()
  const jsonLs = createJsonLs(context)
  const yamlLs = createYamlLs(context)

  return {

    provide: {
      'json/jsonDocument': getJsonDocument,
      'json/languageService': () => jsonLs,
      'yaml/languageService': () => yamlLs,
    },

    triggerCharacters,

    provideCodeActions(document, range, context) {
      if (isYaml(document)) {
        return yamlLs.getCodeAction(document, {
          context,
          range,
          textDocument: document,
        })
      }
    },

    provideCodeLenses(document) {
      if (isYaml(document))
        return yamlLs.getCodeLens(document)
    },

    provideCompletionItems(document, position) {
      if (isYaml(document))
        return yamlLs.doComplete(document, position, false)

      return worker(document, async (jsonDocument) => {
        return await jsonLs.doComplete(document, position, jsonDocument)
      })
    },

    resolveCompletionItem(item) {
      return jsonLs.doResolve(item)
    },

    provideDefinition(document, position) {
      if (isYaml(document))
        return yamlLs.doDefinition(document, { position, textDocument: document })

      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDefinition(document, position, jsonDocument)
      })
    },

    provideDiagnostics(document) {
      if (isYaml(document))
        return yamlLs.doValidation(document, false)

      return worker(document, async (jsonDocument) => {
        const documentLanguageSettings = undefined // await getSettings(); // TODO

        return await jsonLs.doValidation(
          document,
          jsonDocument,
          documentLanguageSettings,
          undefined, // TODO
        ) as json.Diagnostic[]
      })
    },

    provideHover(document, position) {
      if (isYaml(document))
        return yamlLs.doHover(document, position)

      return worker(document, async (jsonDocument) => {
        return await jsonLs.doHover(document, position, jsonDocument)
      })
    },

    provideDocumentLinks(document) {
      if (isYaml(document))
        return yamlLs.findLinks(document)

      return worker(document, async (jsonDocument) => {
        return await jsonLs.findLinks(document, jsonDocument)
      })
    },

    provideDocumentSymbols(document) {
      if (isYaml(document))
        return yamlLs.findDocumentSymbols2(document, {})

      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDocumentSymbols2(document, jsonDocument)
      })
    },

    provideDocumentColors(document) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDocumentColors(document, jsonDocument)
      })
    },

    provideColorPresentations(document, color, range) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.getColorPresentations(document, jsonDocument, color, range)
      })
    },

    provideFoldingRanges(document) {
      if (isYaml(document))
        return yamlLs.getFoldingRanges(document, {})

      return worker(document, async () => {
        return await jsonLs.getFoldingRanges(document)
      })
    },

    provideSelectionRanges(document, positions) {
      if (isYaml(document))
        return yamlLs.getSelectionRanges(document, positions)

      return worker(document, async (jsonDocument) => {
        return await jsonLs.getSelectionRanges(document, positions, jsonDocument)
      })
    },

    resolveCodeLens(codeLens) {
      return yamlLs.resolveCodeLens(codeLens)
    },

    provideDocumentFormattingEdits(document, range, options) {
      return worker(document, async () => {
        const options_2 = await context.env.getConfiguration?.<json.FormattingOptions & { enable: boolean }>('json.format')
        if (!(options_2?.enable ?? true))
          return

        return jsonLs.format(document, range, {
          ...options_2,
          ...options,
        })
      })
    },
  }

  function worker<T>(document: TextDocument, callback: (jsonDocument: json.JSONDocument) => T) {
    const jsonDocument = getJsonDocument(document)
    if (!jsonDocument)
      return

    return callback(jsonDocument)
  }

  function getJsonDocument(textDocument: TextDocument) {
    if (textDocument.languageId !== 'json' && textDocument.languageId !== 'jsonc')
      return

    const cache = jsonDocuments.get(textDocument)
    if (cache) {
      const [cacheVersion, cacheDoc] = cache
      if (cacheVersion === textDocument.version)
        return cacheDoc
    }

    const doc = jsonLs.parseJSONDocument(textDocument)
    jsonDocuments.set(textDocument, [textDocument.version, doc])

    return doc
  }
}
