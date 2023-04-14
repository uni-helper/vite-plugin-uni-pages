import type {
  LanguageServicePlugin,
  LanguageServicePluginInstance,
} from '@volar/language-service'
import * as json from 'vscode-json-languageservice'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import pagesJsonSchema from '@uni-helper/pages-json-schema/schema.json'
import type * as vscode from 'vscode-languageserver-protocol'

pagesJsonSchema.$ref = '#/definitions/PageMetaDatum'
pagesJsonSchema.definitions.PageMetaDatum.required = []

export default (): LanguageServicePlugin => (context): LanguageServicePluginInstance => {
  const triggerCharacters: LanguageServicePluginInstance = {
    // https://github.com/microsoft/vscode/blob/09850876e652688fb142e2e19fd00fd38c0bc4ba/extensions/json-language-features/server/src/jsonServer.ts#L150
    triggerCharacters: ['"', ':'],
  }
  if (!context)
    return triggerCharacters

  const jsonDocuments = new WeakMap<
    TextDocument,
    [number, json.JSONDocument]
  >()
  const jsonLs = json.getLanguageService({})
  jsonLs.configure({
    allowComments: true,
    schemas: [
      {
        fileMatch: ['*.customBlock_route_*.json*'],
        uri: 'foo://route-custom-block.schema.json',
        schema: {
          ...pagesJsonSchema,
        },
      },
    ],
  })

  function worker<T>(
    document: TextDocument,
    callback: (jsonDocument: json.JSONDocument) => T,
  ) {
    const jsonDocument = getJsonDocument(document)
    if (!jsonDocument)
      return
    return callback(jsonDocument)
  }

  function getJsonDocument(textDocument: TextDocument) {
    if (
      textDocument.languageId !== 'json'
      && textDocument.languageId !== 'jsonc'
    )
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
  return {

    // version 1.4.x+
    ...triggerCharacters,

    async resolveRuleContext(context) {
      await worker(context.document, async (jsonDocument) => {
        context.json = {
          document: jsonDocument,
          languageService: jsonLs,
        }
      })
      return context
    },

    provideCompletionItems(document, position) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.doComplete(document, position, jsonDocument)
      })
    },

    resolveCompletionItem(item) {
      return jsonLs.doResolve(item)
    },

    provideDefinition(document, position) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDefinition(document, position, jsonDocument)
      })
    },

    provideSyntacticDiagnostics(document) {
      return worker(document, async (jsonDocument) => {
        const documentLanguageSettings = undefined // await getSettings(); // TODO

        return await jsonLs.doValidation(
          document,
          jsonDocument,
          documentLanguageSettings,
          undefined, // TODO
        ) as vscode.Diagnostic[]
      })
    },

    provideHover(document, position) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.doHover(document, position, jsonDocument)
      })
    },

    provideLinks(document) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findLinks(document, jsonDocument)
      })
    },

    provideDocumentSymbols(document) {
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
      return worker(document, async () => {
        return await jsonLs.getFoldingRanges(document)
      })
    },

    provideSelectionRanges(document, positions) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.getSelectionRanges(document, positions, jsonDocument)
      })
    },

    provideDocumentFormattingEdits(document, range, options) {
      return worker(document, async () => {
        const options_2 = await context.configurationHost?.getConfiguration<json.FormattingOptions & { enable: boolean }>('json.format')
        if (!(options_2?.enable ?? true))
          return

        return jsonLs.format(document, range, {
          ...options_2,
          ...options,
        })
      })
    },

    // version 1.2.x
    // @ts-expect-error ignore
    rules: {
      async onAny(context) {
        await worker(context.document, async (jsonDocument) => {
          context.json = {
            document: jsonDocument,
            languageService: jsonLs,
          }
        })
        return context
      },
    },

    complete: {

      // https://github.com/microsoft/vscode/blob/09850876e652688fb142e2e19fd00fd38c0bc4ba/extensions/json-language-features/server/src/jsonServer.ts#L150
      triggerCharacters: ['"', ':'],

      on(document, position) {
        return worker(document, async (jsonDocument) => {
          return await jsonLs.doComplete(document, position, jsonDocument)
        })
      },

      async resolve(item) {
        return await jsonLs.doResolve(item)
      },
    },

    definition: {

      on(document, position) {
        return worker(document, async (jsonDocument) => {
          return await jsonLs.findDefinition(document, position, jsonDocument)
        })
      },
    },

    validation: {
      onSyntactic(document) {
        return worker(document, async (jsonDocument) => {
          const documentLanguageSettings = undefined // await getSettings(); // TODO

          return await jsonLs.doValidation(
            document,
            jsonDocument,
            documentLanguageSettings,
            undefined, // TODO
          ) as vscode.Diagnostic[]
        })
      },
    },

    doHover(document, position) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.doHover(document, position, jsonDocument)
      })
    },

    findDocumentLinks(document) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findLinks(document, jsonDocument)
      })
    },

    findDocumentSymbols(document) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDocumentSymbols2(document, jsonDocument)
      })
    },

    findDocumentColors(document) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.findDocumentColors(document, jsonDocument)
      })
    },

    getColorPresentations(document, color, range) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.getColorPresentations(document, jsonDocument, color, range)
      })
    },

    getFoldingRanges(document) {
      return worker(document, async () => {
        return await jsonLs.getFoldingRanges(document)
      })
    },

    getSelectionRanges(document, positions) {
      return worker(document, async (jsonDocument) => {
        return await jsonLs.getSelectionRanges(document, positions, jsonDocument)
      })
    },

    format(document, range, options) {
      return worker(document, async () => {
        const options_2 = await context.configurationHost?.getConfiguration<json.FormattingOptions & { enable: boolean }>('json.format')
        if (!(options_2?.enable ?? true))
          return

        return jsonLs.format(document, range, {
          ...options_2,
          ...options,
        })
      })
    },
  }
}
