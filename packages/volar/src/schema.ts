import pagesJsonSchema from '@uni-helper/pages-json-schema/schema.json'

pagesJsonSchema.$ref = '#/definitions/Page'
pagesJsonSchema.definitions.Page.required = []

export const schema = pagesJsonSchema
