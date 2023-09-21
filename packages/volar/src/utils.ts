import { type TextDocument } from 'vscode-languageserver-textdocument'

export function isYaml(document: TextDocument): boolean {
  return document.languageId === 'yaml'
}
