import type { ServiceContext } from '@volar/language-service'
import * as json from 'vscode-json-languageservice'
import { schema } from './schema'

export function createJsonLs(_context: ServiceContext) {
  const jsonLs = json.getLanguageService({})
  jsonLs.configure({
    allowComments: true,
    schemas: [
      {
        fileMatch: ['*.customBlock_route_*.json*'],
        uri: 'foo://route-custom-block.schema.json',
        schema,
      },
    ],
  })
  return jsonLs
}
