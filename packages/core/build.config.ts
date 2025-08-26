import process from 'node:process'
import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index'],
  declaration: true,
  clean: true,
  sourcemap: process.env.NODE_ENV === 'development',
  rollup: {
    emitCJS: true,
    inlineDependencies: true,
  },
})
