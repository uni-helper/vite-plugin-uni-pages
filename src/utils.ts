import { resolve } from 'path'
import { createFilter } from 'vite'
import consola from 'consola'
import type { ResolvedOptions } from './types'

export const isPagePath = (path: string, options: ResolvedOptions) => {
  const dirPath = resolve(process.cwd(), options.pagesDir)
  const filter = createFilter(
    `${dirPath}/**/*.(vue|nvue|uvue)`,
    options.exclude,
  )
  return filter(path)
}

export const logger = consola.create({
  defaults: {
    tag: 'vite-plugin-uni-pages',
  },
})
