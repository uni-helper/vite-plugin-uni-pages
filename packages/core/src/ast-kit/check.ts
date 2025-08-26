import type * as t from '@babel/types'

export function isCallOf(
  node: t.Node | null | undefined,
  test: string | string[] | ((id: string) => boolean),
): node is t.CallExpression {
  return (
    !!node
    && node.type === 'CallExpression'
    && isIdentifierOf(node.callee, test)
  )
}

export function isTaggedFunctionCallOf(
  node: t.Node | null | undefined,
  test: string | string[] | ((id: string) => boolean),
): node is t.TaggedTemplateExpression {
  return (
    !!node
    && node.type === 'TaggedTemplateExpression'
    && isIdentifierOf(node.tag, test)
  )
}

export function isIdentifierOf(
  node: t.Node | undefined | null,
  test: string | string[] | ((id: string) => boolean),
): node is t.Identifier {
  return isIdentifier(node) && match(node.name, test)
}

export function isIdentifier(
  node?: t.Node | undefined | null,
): node is t.Identifier {
  return !!node && (node.type === 'Identifier' || node.type === 'JSXIdentifier')
}

function match<T extends string | number | boolean>(
  value: T,
  test: T | T[] | ((id: T) => boolean),
): boolean {
  if (Array.isArray(test))
    return test.includes(value)
  if (typeof test === 'function')
    return test(value)
  return value === test
}
