import * as json from 'vscode-json-languageservice'
import type { ServiceContext } from '@volar/language-service'
import { schema } from './schema'
import { createGenerator } from "ts-json-schema-generator";
import type { PluginConfig } from './index'
import { JSONSchema7 } from 'json-schema';


export function createJsonLs(_context: ServiceContext, config: PluginConfig) {
  const jsonLs = json.getLanguageService({})
  try {
    const key = 'ExtraPageMetaDatum'
    const pageMetaDatumSchema = createGenerator({
      skipTypeCheck: true,
      type: key,
      tsconfig: './tsconfig.json',
      ...config,
    }).createSchema(key);

    const pageMeta = pageMetaDatumSchema.definitions
    if (pageMeta) {
      schema.definitions.PageMetaDatum = {
        ...schema.definitions.PageMetaDatum,
        // @ts-expect-error Ignore type
        ...pageMeta[key],
      }
    }
  } catch (e) {
    console.log("[Error] @uni-helper/volar-service-uni-pages:");
    console.log(e);
  }


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
