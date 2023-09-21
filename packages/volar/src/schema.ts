import pagesJsonSchema from '@uni-helper/pages-json-schema/schema.json'

pagesJsonSchema.$ref = '#/definitions/PageMetaDatum'
pagesJsonSchema.definitions.PageMetaDatum.required = []

export const schema = pagesJsonSchema
