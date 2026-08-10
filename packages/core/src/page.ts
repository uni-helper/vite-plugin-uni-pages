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

  /**
   * Whether the page opted out of pages.json via `definePage(null)` or a
   * function-form macro returning null on the current platform
   */
  skipped: boolean = false

  /** Whether the page file has been read at least once */
  private loaded: boolean = false

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
    if (forceUpdate || !this.loaded)
      await this.read()

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
    if (forceUpdate || !this.loaded) {
      await this.read()
    }

    // A page that opted out via definePage(null) must not contribute a tabBar item
    if (this.skipped)
      return undefined

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
   * Ensure the page file has been read at least once, so `skipped` and the
   * cached metadata reflect the current file content
   */
  public async ensureLoaded(): Promise<void> {
    if (!this.loaded)
      await this.read()
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
    let meta: UserPageItem | undefined
    let skipped = false
    try {
      const result = await this.readPageMetaFromFile()
      if (result === null) {
        skipped = true
      }
      else {
        meta = result
      }
    }
    catch (err: any) {
      debug.error(err)
      return // break if read fail
    }

    let raw = ''
    try {
      // JSON.stringify(undefined) returns undefined for skipped pages, so
      // normalize to keep `raw` a string and the change check stable
      raw = JSON.stringify(meta) ?? ''
    }
    catch {
      // ignore stringify error
    }

    this.changed = this.raw !== raw || this.skipped !== skipped
    this.loaded = true
    this.meta = meta
    this.raw = raw
    this.skipped = skipped
  }

  private async readPageMetaFromFile(): Promise<UserPageItem | null> {
    try {
      const content = await fs.promises.readFile(this.path.absolutePath, { encoding: 'utf-8' })
      const meta = await evaluateDefinePage(content, this.path.absolutePath, this.ctx.platform)
      // undefined means no definePage macro: keep the page with default meta.
      // null is an explicit opt-out and must propagate to the caller untouched.
      return meta === undefined ? { type: 'page' } : meta
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.relativePath}\n${err.message}`)
    }
  }
}
