import * as json from 'vscode-json-languageservice'
import type { ServiceContext } from '@volar/language-service'
import { schema } from './schema'
import { createGenerator } from "ts-json-schema-generator";
import type { PluginConfig } from './index'
import { JSONSchema7 } from 'json-schema';

export function createJsonLs(_context: ServiceContext, config: PluginConfig) {
  const jsonLs = json.getLanguageService({})
  try {
    const routeMetaSchema = createGenerator({
      skipTypeCheck: true,
      type: "UniPagesRouteMeta",
      tsconfig: './tsconfig.json',
      ...config,
    }).createSchema("UniPagesRouteMeta");

    const routeMeta = routeMetaSchema.definitions.UniPagesRouteMeta as JSONSchema7
    if (routeMeta) {
      for (const key in schema.definitions) {
        const exist = routeMeta.properties[key]
        if (exist && typeof exist === 'object') {
          schema.definitions[key] = {
            ...schema.definitions[key],
            ...exist
          }
        }
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
