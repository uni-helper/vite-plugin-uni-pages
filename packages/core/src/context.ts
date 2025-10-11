import type { FSWatcher } from 'chokidar'
import type { CommentObject, CommentSymbol } from 'comment-json'
import type { Logger, ViteDevServer } from 'vite'
import type { KnownKeys, Page, PagesJson, PathSet, ResolvedOptions, SubPackage, TabBar, TabBarItem, UserOptions } from './types'

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { slash } from '@antfu/utils'
import { platform } from '@uni-helper/uni-env'
import { parse as cjParse, stringify as cjStringify, CommentArray } from 'comment-json'
import dbg from 'debug'
import detectIndent from 'detect-indent'

import detectNewline from 'detect-newline'
import { loadConfig } from 'unconfig'
import { OUTPUT_NAME } from './constant'
import { writeDeclaration } from './declaration'
import { checkPagesJsonFileSync, getPathSets, writeFileWithLock } from './files'
import { resolveOptions } from './options'
import { PAGE_TYPE_KEY, PageFile } from './pageFile'
import {
  debug,
  invalidatePagesModule,
  isTargetFile,
  mergePageMetaDataArray,
} from './utils'

export class Context {
  private _server: ViteDevServer | undefined

  pagesGlobConfig: PagesJson | undefined
  pagesConfigSourcePaths: string[] = []

  pageFiles = new Map<string, PageFile>() // abs path -> PageFile
  subPageFiles = new Map<string, Map<string, PageFile>>() // root -> abs path -> page
  pages: Page[] = []
  subPackages: SubPackage[] = []

  resolvedPagesJSONPath = ''
  private resolvedPagesJSONIndent?: string // '  '
  private resolvedPagesJSONNewline?: string // '\n'
  private resolvedPagesJSONEofNewline?: boolean // true

  rawOptions: UserOptions
  root: string
  options: ResolvedOptions
  logger?: Logger

  withUniPlatform = false

  private lastPagesJson = ''

  constructor(userOptions: UserOptions, viteRoot: string = process.cwd()) {
    this.rawOptions = userOptions
    this.root = slash(viteRoot)
    debug.options('root', this.root)
    this.options = resolveOptions(userOptions, this.root)
    // debug logic
    const debugOption = this.options.debug
    if (debugOption) {
      const prefix = 'vite-plugin-uni-pages:'
      const suffix = typeof debugOption === 'boolean' ? '*' : debugOption
      dbg.enable(`${prefix}${suffix}`)
    }
    this.resolvedPagesJSONPath = path.join(this.root, this.options.outDir, OUTPUT_NAME)
    debug.options(this.options)
  }

  setLogger(logger: Logger) {
    this.logger = logger
  }

  async loadUserPagesConfig() {
    const configSource = this.options.configSource
    const { config, sources } = await loadConfig<PagesJson>({ cwd: this.root, sources: configSource, defaults: {} })
    this.pagesGlobConfig = config.default || config
    this.pagesConfigSourcePaths = sources
    debug.options(this.pagesGlobConfig)
  }

  async scanPages() {
    const pageDirFiles = this.options.dirs.map((dir) => {
      return { dir, files: getPathSets(dir, this.options) }
    })

    const paths = pageDirFiles.map(page => page.files).flat()
    debug.pages(paths)

    const pageFiles = new Map<string, PageFile>()
    for (const path of paths) {
      const page = this.pageFiles.get(path.abs) || new PageFile(this, path)
      pageFiles.set(path.abs, page)
    }

    this.pageFiles = pageFiles
  }

  async scanSubPages() {
    const paths: Record<string, PathSet[]> = {}
    const subPageFiles = new Map<string, Map<string, PageFile>>()
    for (const dir of this.options.subPackages) {
      const pagePaths = getPathSets(dir, this.options)
      paths[dir] = pagePaths

      const pageFiles = new Map<string, PageFile>()
      for (const path of pagePaths) {
        const page = this.subPageFiles.get(dir)?.get(path.abs) || new PageFile(this, path)
        pageFiles.set(path.abs, page)
      }
      subPageFiles.set(dir, pageFiles)
    }
    debug.subPages(JSON.stringify(paths, null, 2))

    this.subPageFiles = subPageFiles
  }

  setupViteServer(server: ViteDevServer) {
    if (this._server === server)
      return

    this._server = server
    this.setupWatcher(server.watcher)
  }

  async setupWatcher(watcher: FSWatcher) {
    watcher.add(this.pagesConfigSourcePaths)
    const targetDirs = [...this.options.dirs, ...this.options.subPackages].map(v => slash(path.resolve(this.root, v)))
    const isInTargetDirs = (filePath: string) => targetDirs.some(v => slash(path.resolve(this.root, filePath)).startsWith(v))

    watcher.on('add', async (path) => {
      path = slash(path)

      if (!isTargetFile(path))
        return

      if (!isInTargetDirs(path))
        return

      debug.pages(`File added: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return
      if (!isInTargetDirs(path))
        return

      debug.pages(`File changed: ${path}`)
      debug.pages(targetDirs)
      debug.pages(isInTargetDirs(path))
      if (await this.updatePagesJSON(path))
        this.onUpdate()
    })

    watcher.on('change', async (path) => {
      if (this.pagesConfigSourcePaths.includes(path)) {
        debug.pages(`Config source changed: ${path}`)
        if (await this.updatePagesJSON())
          this.onUpdate()
      }
    })

    watcher.on('unlink', async (path) => {
      path = slash(path)
      if (!isTargetFile(path))
        return

      if (!isInTargetDirs(path))
        return

      debug.pages(`File removed: ${path}`)
      if (await this.updatePagesJSON())
        this.onUpdate()
    })
  }

  onUpdate() {
    if (!this._server)
      return

    invalidatePagesModule(this._server)
    debug.hmr('Reload generated pages.')
    this._server.ws.send({
      type: 'full-reload',
    })
  }

  /**
   * parse pages rules && set page type
   * @param pages page path array
   * @param type  page type
   * @param overrides custom page config
   * @returns pages rules
   */
  async parsePages(pages: Map<string, PageFile>, type: 'main' | 'sub', overrides?: Page[]) {
    const jobs: Promise<Page>[] = []
    for (const [_, page] of pages) {
      jobs.push(page.getPageMeta())
    }
    const generatedPageMetaData = await Promise.all(jobs)
    const customPageMetaData = overrides || []

    const result = customPageMetaData.length
      ? mergePageMetaDataArray(generatedPageMetaData.concat(customPageMetaData))
      : generatedPageMetaData

    // 使用 Map 去重，保留每个 path 的最后一个元素，同时保持较好的性能
    const parseMeta = Array.from(
      result.reduce((map, page) => {
        map.set(page.path, page)
        return map
      }, new Map<string, Page>()).values(),
    )

    return type === 'main' ? this.setHomePage(parseMeta) : parseMeta
  }

  /**
   * set home page
   * @param result pages rules array
   * @returns pages rules
   */
  setHomePage(result: Page[]): Page[] {
    const hasHome = result.some(p => (p as any)[PAGE_TYPE_KEY] === 'home')
    if (!hasHome) {
      const isFoundHome = result.some((item) => {
        const isFound = this.options.homePage.find(v => (v === item.path))
        if (isFound)
          (item as any)[PAGE_TYPE_KEY] = 'home'

        return isFound
      })

      if (!isFoundHome) {
        this.logger?.warn('No home page found, check the configuration of pages.config.ts, or add the `homePage` option to UniPages in vite.config.js, or add `type="home"` to the routeBlock of your vue page.', {
          timestamp: true,
        })
      }
    }

    result.sort(page => ((page as any)[PAGE_TYPE_KEY] === 'home' ? -1 : 0))

    return result
  }

  async mergePageMetaData() {
    const pages = await this.parsePages(this.pageFiles, 'main', this.pagesGlobConfig?.pages)

    this.pages = pages
    debug.pages(this.pages)
  }

  async mergeSubPageMetaData() {
    const subPageMaps = (this.pagesGlobConfig?.subPackages || []).reduce(
      (map, item) => {
        map[item.root] = item
        return map
      },
      {} as Record<string, SubPackage>,
    )

    for (const [dir, pfiles] of this.subPageFiles) {
      const basePath = slash(path.join(this.options.root, this.options.outDir))
      const root = slash(path.relative(basePath, path.join(this.options.root, dir)))

      const pkg = subPageMaps[root] || { root }
      const pages = await this.parsePages(pfiles, 'sub', pkg.pages)
      pkg.pages = pages.map(page => ({ ...page, path: slash(path.relative(root, page.path)) }))
      subPageMaps[root] = pkg
    }

    this.subPackages = Object.values(subPageMaps).filter(pkg => pkg.pages.length > 0)
    debug.subPages(this.subPackages)
  }

  private async getTabBarMerged(): Promise<TabBar | undefined> {
    const tabBarItems: (TabBarItem & { index: number })[] = []
    for (const [_, pf] of this.pageFiles) {
      const tabbar = await pf.getTabBar()
      if (tabbar) {
        tabBarItems.push(tabbar)
      }
    }

    if (tabBarItems.length === 0) {
      return this.pagesGlobConfig?.tabBar
    }

    const tabBar = {
      ...this.pagesGlobConfig?.tabBar,
      list: this.pagesGlobConfig?.tabBar?.list || [],
    }

    const pagePaths = new Map<string, boolean>()
    for (const item of tabBar.list) {
      pagePaths.set(item.pagePath, true)
    }

    tabBarItems.sort((a, b) => a.index - b.index)

    for (const item of tabBarItems) {
      if (!pagePaths.has(item.pagePath)) {
        const { index: _, ...tabbar } = item
        tabBar.list.push(tabbar)
      }
    }

    return tabBar
  }

  async updatePagesJSON(filepath?: string) {
    if (filepath) {
      let pageFile = this.pageFiles.get(filepath)
      if (!pageFile) {
        let subPageFile: PageFile | undefined
        for (const [_, pageFiles] of this.subPageFiles) {
          subPageFile = pageFiles.get(filepath)
          if (subPageFile) {
            break
          }
        }
        pageFile = subPageFile
      }
      if (pageFile) {
        await pageFile.read()
        if (!pageFile.hasChanged()) {
          debug.cache(`The route block on page ${filepath} did not send any changes, skipping`)
          return false
        }
      }
    }

    checkPagesJsonFileSync(this.resolvedPagesJSONPath)
    this.options.onBeforeLoadUserConfig(this)
    await this.loadUserPagesConfig()
    this.options.onAfterLoadUserConfig(this)

    if (this.options.mergePages) {
      this.options.onBeforeScanPages(this)
      await this.scanPages()
      await this.scanSubPages()
      this.options.onAfterScanPages(this)
    }

    this.options.onBeforeMergePageMetaData(this)
    await this.mergePageMetaData()
    await this.mergeSubPageMetaData()
    this.options.onAfterMergePageMetaData(this)

    const pagesMap = new Map()
    const pages = this.withUniPlatform
      ? this.pages.filter(v => !/\..*$/.test(v.path) || v.path.includes(platform)).map((v) => {
          v.path = v.path.replace(/\..*$/, '')
          return v
        })
      : this.pages
    pages.forEach(v => pagesMap.set(v.path, v))
    this.pages = [...pagesMap.values()]

    this.options.onBeforeWriteFile(this)

    const data = await this.genratePagesJSON()

    const pagesJson = cjStringify(
      data,
      null,
      this.options.minify ? undefined : await this.getIndent(),
    ) + (
      await this.getEndOfLine() ? await this.getNewline() : ''
    )
    this.generateDeclaration()
    if (this.lastPagesJson === pagesJson) {
      debug.pages('PagesJson Not have change')
      return false
    }

    await writeFileWithLock(this.resolvedPagesJSONPath, pagesJson)

    this.lastPagesJson = pagesJson

    this.options.onAfterWriteFile(this)
    return true
  }

  virtualModule() {
    const pages = `export const pages = ${this.resolveRoutes()};`
    const subPackages = `export const subPackages = ${this.resolveSubRoutes()};`
    return [pages, subPackages].join('\n')
  }

  resolveRoutes() {
    return cjStringify(this.pages, null, 2)
  }

  resolveSubRoutes() {
    return cjStringify(this.subPackages, null, 2)
  }

  generateDeclaration() {
    if (!this.options.dts)
      return

    debug.declaration('generating')
    return writeDeclaration(this, this.options.dts)
  }

  private async genratePagesJSON() {
    const content = await fs.promises.readFile(this.resolvedPagesJSONPath, { encoding: 'utf-8' }).catch(() => '')

    const { pages: oldPages, subPackages: oldSubPackages, tabBar: oldTabBar } = cjParse(content || '{}') as CommentObject

    const { pages: _, subPackages: __, tabBar: ___, ...pageJson } = this.pagesGlobConfig || {}

    const currentPlatform = platform.toUpperCase()

    // pages
    pageJson.pages = mergePlatformItems(oldPages as any, currentPlatform, this.pages, 'path')

    // subPackages
    pageJson.subPackages = oldSubPackages || new CommentArray<CommentObject>()
    const newSubPackages = new Map<string, SubPackage>()
    for (const item of this.subPackages) {
      newSubPackages.set(item.root, item)
    }
    for (const existing of pageJson.subPackages as unknown as SubPackage[]) {
      const sub = newSubPackages.get(existing.root)
      if (sub) {
        existing.pages = mergePlatformItems(existing.pages, currentPlatform, sub.pages, 'path') as any
        newSubPackages.delete(existing.root)
      }
    }
    for (const [_, newSub] of newSubPackages) {
      (pageJson.subPackages as unknown as Array<any>).push({
        root: newSub.root,
        pages: mergePlatformItems(undefined, currentPlatform, newSub.pages, 'path'),
      })
    }

    // tabbar
    const { list, ...tabBarOthers } = (await this.getTabBarMerged()) || {}
    if (list) {
      const { list: oldList } = (oldTabBar as any) || {}
      const newList = mergePlatformItems(oldList, currentPlatform, list, 'pagePath')
      pageJson.tabBar = {
        ...tabBarOthers, // 每次都直接更新除 list 外的其他属性
        list: newList,
      }
    }
    else {
      pageJson.tabBar = undefined // 直接清空，暂不支持 A 平台有 tabBar， B 平台无 tabBar 的情况。
    }

    return pageJson
  }

  private async readInfoFromPagesJSON(): Promise<void> {
    const resolvedPagesJSONContent = await fs.promises.readFile(this.resolvedPagesJSONPath, { encoding: 'utf-8' }).catch(() => '')
    this.resolvedPagesJSONIndent = detectIndent(resolvedPagesJSONContent).indent || '  '
    this.resolvedPagesJSONNewline = detectNewline(resolvedPagesJSONContent) || '\n'
    this.resolvedPagesJSONEofNewline = (resolvedPagesJSONContent.at(-1) ?? '\n') === this.resolvedPagesJSONNewline
  }

  private async getIndent() {
    if (!this.resolvedPagesJSONIndent) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONIndent!
  }

  private async getNewline() {
    if (!this.resolvedPagesJSONNewline) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONNewline!
  }

  private async getEndOfLine() {
    if (!this.resolvedPagesJSONEofNewline) {
      await this.readInfoFromPagesJSON()
    }

    return this.resolvedPagesJSONEofNewline!
  }
}

function mergePlatformItems<T = any>(source: any[] | undefined, currentPlatform: string, items: T[], uniqueKeyName: KnownKeys<T>): CommentArray<CommentObject> {
  const src = (source as CommentArray<CommentObject>) || new CommentArray<CommentObject>()
  currentPlatform = currentPlatform.toUpperCase()

  // 1. 从 CommentArray 里抽取第一个注释并获取 platforms 作为 lastPlatforms
  let lastPlatforms: string[] = []
  for (const comment of (src[Symbol.for('before:0') as CommentSymbol] || [])) {
    const trimed = comment.value.trim()
    if (trimed.startsWith('GENERATED BY UNI-PAGES, PLATFORM:')) {
      // 移除当前 platform
      lastPlatforms = trimed.split(':')[1].split('||').map(s => s.trim()).filter(s => s !== currentPlatform).sort()
    }
  }

  // 2. 遍历 source，对每个元素进行判断，然后以 uniqueKey 元素的值作为 key 添加到新的 tmpMap 中
  interface MultiPlatformItem {
    item: T
    itemStr: string
    platforms: string[]
    platformStr: string
  }
  const tmpMap = new Map<string, MultiPlatformItem[]>()

  for (let i = 0; i < src.length; i++) {
    const item = src[i] as T
    const uniqueKey = (item as any)[uniqueKeyName]

    if (!uniqueKey) {
      continue
    }

    // 检查是否有条件编译注释
    const beforeComments = src[Symbol.for(`before:${i}`) as CommentSymbol]
    // const afterComments = src[Symbol.for(`after:${i}`) as CommentSymbol]

    const ifdefComment = beforeComments?.find(c => c.value.trim().startsWith('#ifdef'))
    // const endifComment = afterComments?.find(c => c.value.trim().startsWith('#endif'))

    let platforms: string[] = [...lastPlatforms]

    if (ifdefComment) {
      const match = ifdefComment.value.match(/#ifdef\s+(.+)/)
      if (match) {
        // 移除当前 platform
        platforms = match[1].split('||').map(p => p.trim()).filter(s => s !== currentPlatform).sort()
      }
    }

    // 如果 platforms 除了当前 platform 外为空，则跳过
    if (platforms.length === 0) {
      continue
    }

    const existing = tmpMap.get(uniqueKey) || []
    existing.push({ item, itemStr: JSON.stringify(item), platforms, platformStr: platforms.join(' || ') })
    tmpMap.set(uniqueKey, existing)
  }

  // 3. 将 items 合并到 tmpMap 中
  for (const item of items) {
    const newItem = item
    const uniqueKey = item[uniqueKeyName] as string

    if (!uniqueKey) {
      continue
    }

    if (!tmpMap.has(uniqueKey)) {
      // 如果不存在，则添加到 newMap 中
      tmpMap.set(uniqueKey, [{
        item: newItem,
        itemStr: JSON.stringify(newItem),
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      }])
      continue
    }

    // 如果存在，判断元素是否相等
    const existing = tmpMap.get(uniqueKey)!

    const newItemStr = JSON.stringify(newItem)
    const equalObj = existing.find(val => val.itemStr === newItemStr)
    if (equalObj) {
      equalObj.platforms.push(currentPlatform)
      equalObj.platformStr = equalObj.platforms.join(' || ')
    }
    else {
      existing.push({
        item: newItem,
        itemStr: newItemStr,
        platforms: [currentPlatform],
        platformStr: currentPlatform,
      })
    }
  }

  // 4. 遍历 tmpMap，生成 result:CommentArray<CommentObject>
  const result = new CommentArray<CommentObject>()

  // 检查平台的使用频率，将使用频率高的平台作为默认平台
  const platformUsage: Record<string, number> = {}
  tmpMap.forEach((val) => {
    Object.values(val).forEach((v) => {
      platformUsage[v.platformStr] = (platformUsage[v.platformStr] || 0) + 1
    })
  })
  const usageKeys = Object.keys(platformUsage)
  const defaultPlatformStr = usageKeys.length
    ? usageKeys.reduce((a, b) => (platformUsage[a] > platformUsage[b] ? a : b))
    : currentPlatform

  // 为 result 添加 Symbol.for(`before:0`) 添加生成标识注释
  result[Symbol.for('before:0') as CommentSymbol] = [{
    type: 'LineComment',
    value: ` GENERATED BY UNI-PAGES, PLATFORM: ${defaultPlatformStr}`,
    inline: false,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }]

  // 按照插入顺序处理元素
  for (const [_, list] of tmpMap) {
    for (const { item, platformStr } of list) {
      result.push(item as CommentObject)

      // 检查 platforms 是否和 defaultPlatformStr 一致。（platforms、defaultPlatforms 已预先排序）
      if (platformStr !== defaultPlatformStr) {
      // 存在平台信息且与默认平台不同，添加条件编译注释
        result[Symbol.for(`before:${result.length - 1}`) as CommentSymbol] = [{
          type: 'LineComment',
          value: ` #ifdef ${platformStr}`,
          inline: false,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        }]

        result[Symbol.for(`after:${result.length - 1}`) as CommentSymbol] = [{
          type: 'LineComment',
          value: ' #endif',
          inline: false,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        }]
      }
    }
  }

  // 5. 返回 result:CommentArray<CommentObject>
  return result
}
