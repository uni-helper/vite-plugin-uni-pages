import type { ServiceContext } from '@volar/language-service'
import { getLanguageService } from 'yaml-language-server'
import { schema } from './schema'

function noop(): undefined { }

export function createYamlLs(context: ServiceContext) {
  const ls = getLanguageService({
    schemaRequestService: async uri => await context.env.fs?.readFile(uri) ?? '',
    telemetry: {
      send: noop,
      sendError: noop,
      sendTrack: noop,
    },
    // @ts-expect-error https://github.com/redhat-developer/yaml-language-server/pull/910
    clientCapabilities: context?.env?.clientCapabilities,
    workspaceContext: {
      resolveRelativePath(relativePath, resource) {
        return String(new URL(relativePath, resource))
      },
    },
  })

  ls.configure({
    completion: true,
    customTags: [],
    format: true,
    hover: true,
    isKubernetes: false,
    validate: true,
    yamlVersion: '1.2',
    schemas: [
      {
        fileMatch: ['*.customBlock_route_*.yaml*'],
        uri: 'foo://route-custom-block.schema.yaml',
        name: 'volar-service-uni-pages',
        description: 'Volar plugin for uni-pages route custom block in Vue SFC',
        schema,
      },
    ],
  })

  return ls
}
