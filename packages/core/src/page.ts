import type { TabBarItem } from './config'
import type { PageContext } from './context'
import type { InternalPageItem, PagePath, UserPageItem } from './types'
import fs from 'node:fs'
import { extname } from 'node:path'
import { normalizePath } from 'vite'
import { debug } from './logger'
import { evaluateDefinePage } from './macro'

/**
 * Page class representing a Vue page file
 *
 * Responsibilities:
 * 1. Read page file content
 * 2. Parse page metadata defined by definePage macro
 * 3. Provide tabBar configuration information
 * 4. Track page file change status
 */
export class Page {
  /** Page context instance */
  ctx: PageContext

  /** Page path information containing relative and absolute paths */
  path: PagePath
  /** Page URI used for pages.json path field */
  uri: string

  /** Whether the page has changed, used for incremental update judgment */
  changed: boolean = true

  /** Raw JSON string of page metadata for change detection */
  private raw: string = ''
  /** Parsed page metadata */
  private meta: UserPageItem | undefined

  /**
   * Create a page instance
   * @param ctx - Page context instance
   * @param path - Page path information
   */
  constructor(ctx: PageContext, path: PagePath) {
    this.ctx = ctx
    this.path = path
    this.uri = normalizePath(path.relativePath.replace(extname(path.relativePath), ''))
  }

  /**
   * Get page metadata
   * Parse configuration defined by definePage macro and return metadata for pages.json
   *
   * @param forceUpdate - Whether to force update, ignoring cache
   * @returns Page metadata object
   */
  public async getPageMeta(forceUpdate = false): Promise<InternalPageItem> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { path, tabBar: _, ...others } = this.meta || {}

    return {
      path: path ?? this.uri,
      ...others,
    }
  }

  /**
   * Get page tabBar configuration
   * Extract tabBar related configuration from definePage macro
   *
   * @param forceUpdate - Whether to force update, ignoring cache
   * @returns tabBar configuration object, or undefined if page doesn't define tabBar
   */
  public async getTabBar(forceUpdate = false): Promise<TabBarItem & { index: number } | undefined> {
    if (forceUpdate || !this.meta) {
      await this.read()
    }

    const { tabBar } = this.meta || {}

    if (tabBar === undefined) {
      return undefined
    }

    return {
      ...tabBar,
      pagePath: tabBar.pagePath || this.uri,
      index: tabBar.index ?? 0,
    }
  }

  /**
   * Check if the page has changed
   * @returns Whether the page has changed
   */
  public hasChanged(): boolean {
    return this.changed
  }

  /**
   * Read page file and parse metadata
   * Extract configuration defined by definePage macro from Vue SFC
   */
  public async read(): Promise<void> {
    let meta: UserPageItem
    try {
      meta = await this.readPageMetaFromFile()
    }
    catch (err: any) {
      debug.error(err)
      return // break if read fail
    }

    let raw = ''
    try {
      raw = JSON.stringify(meta)
    }
    catch {
      // ignore stringify error
    }

    this.changed = this.raw !== raw
    this.meta = meta
    this.raw = raw
  }

  private async readPageMetaFromFile(): Promise<UserPageItem> {
    try {
      const content = await fs.promises.readFile(this.path.absolutePath, { encoding: 'utf-8' })
      const meta = await evaluateDefinePage(content, this.path.absolutePath)
      if (meta) {
        return meta
      }

      return { type: 'page' }
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.relativePath}\n${err.message}`)
    }
  }
}
