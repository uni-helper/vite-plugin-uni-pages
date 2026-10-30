import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { PagesConfigLoader } from '../packages/core/src/config-loader'
import { createFixture } from './helpers/fixture'

it('入口和辅助模块的 import.meta 解构、别名与计算式访问保留各自源位置', async () => {
  const fixture = createFixture('uni-pages-config-meta-')
  fixture.write('package.json', '{"type":"module"}')
  fixture.write('target.json', '{"name":"entry"}')
  fixture.write('nested/target.json', '{"name":"nested"}')
  const code = `
    import { readFileSync } from 'node:fs'
    const { url, dirname, filename, resolve } = import.meta
    const meta = import.meta
    const member = key => import.meta[key]
    const target = './target.json'
    const read = resolve => JSON.parse(readFileSync(new URL(resolve(target)), 'utf8'))
    const info = {
      destructured: { url, dirname, filename, resolved: resolve(target), value: read(resolve) },
      alias: { url: meta.url, resolved: meta.resolve(target), value: read(meta.resolve) },
      computed: { url: member('url'), resolved: member('resolve')(target), value: read(member('resolve')) },
    }
  `
  fixture.write('nested/helper.ts', `${code}; export default info`)
  fixture.write('pages.config.ts', `import nested from './nested/helper.ts'; ${code}; export default { entry: info, nested }`)

  const { config } = await new PagesConfigLoader(fixture.root).load([{ files: 'pages.config.ts', extensions: [] }])
  const expected = (name: string, directory: string, file: string) => {
    const url = pathToFileURL(fixture.path(file)).href
    const resolved = pathToFileURL(fixture.path(`${directory}target.json`)).href
    const value = { name }
    return {
      destructured: { url, dirname: fixture.path(directory), filename: fixture.path(file), resolved, value },
      alias: { url, resolved, value },
      computed: { url, resolved, value },
    }
  }
  expect(config).toEqual({
    entry: expected('entry', '', 'pages.config.ts'),
    nested: expected('nested', 'nested/', 'nested/helper.ts'),
  })
})

it('各模块保留独立的 import.meta 对象并通过所有访问方式共享 env', async () => {
  const fixture = createFixture('uni-pages-config-meta-env-')
  fixture.write('package.json', '{"type":"module"}')
  fixture.write('nested/helper.ts', `
    export const meta = import.meta
    export const { env } = import.meta
    export const directEnv = import.meta.env
    export const member = key => import.meta[key]
  `)
  fixture.write('pages.config.ts', `
    import { meta as nestedMeta, env as nestedEnv, directEnv, member } from './nested/helper.ts'
    const meta = import.meta
    const { env } = import.meta
    export default {
      separateMeta: meta !== nestedMeta,
      sameMeta: meta === import.meta,
      sharedEnv: env === nestedEnv && env === directEnv && env === member('env') && env === meta.env && env === import.meta.env,
      values: { mode: env.MODE, title: env.VITE_TITLE, keys: Object.keys(env).sort() },
      main: [meta.main, nestedMeta.main],
      unavailable: { direct: import.meta.glob, alias: meta.hot, computed: member('missing'), inherited: meta.toString },
    }
  `)
  const loader = new PagesConfigLoader(fixture.root)
  loader.setEnv({ MODE: 'staging', VITE_TITLE: 'shared' })

  const { config } = await loader.load([{ files: 'pages.config.ts', extensions: [] }])
  expect(config).toEqual({
    separateMeta: true,
    sameMeta: true,
    sharedEnv: true,
    values: { mode: 'staging', title: 'shared', keys: ['MODE', 'VITE_TITLE'] },
    main: [false, false],
    unavailable: { direct: undefined, alias: undefined, computed: undefined, inherited: undefined },
  })
})
