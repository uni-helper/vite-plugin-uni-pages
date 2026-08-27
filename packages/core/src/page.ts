import type { TabBarItem } from '@uni-helper/uni-pages-types'
import type { PageContext } from './context'
import type { InternalPageItem, PagePath, UserPageItem } from './types'
import fs from 'node:fs'
import { extname } from 'node:path'
import { normalizePath } from 'vite'
import { debug } from './logger'
import { evaluateDefinePage } from './macro'

/**
 * 表示一个 Vue 页面文件的 Page 类
 *
 * 职责：
 * 1. 读取页面文件内容
 * 2. 解析 definePage 宏定义的页面配置
 * 3. 提供 tabBar 配置信息
 * 4. 跟踪页面文件变更状态
 */
export class Page {
  /** 页面上下文实例 */
  ctx: PageContext

  /** 页面路径信息，包含相对路径与绝对路径 */
  path: PagePath
  /** 页面 URI，用于 pages.json 的 path 字段 */
  uri: string

  /** 页面是否发生变化，用于增量更新判断 */
  changed: boolean = true

  /**
   * 页面是否通过 `definePage(null)` 或函数式宏在当前平台返回 null 而
   * 退出了 pages.json
   */
  skipped: boolean = false

  /** 页面文件是否至少被读取过一次 */
  private loaded: boolean = false

  /** 页面配置的原始 JSON 字符串，用于变更检测 */
  private raw: string = ''
  /** 解析后的页面配置 */
  private meta: UserPageItem | undefined

  /**
   * 创建页面实例
   * @param ctx - 页面上下文实例
   * @param path - 页面路径信息
   */
  constructor(ctx: PageContext, path: PagePath) {
    this.ctx = ctx
    this.path = path
    // 只从路径末尾剥掉扩展名。目录名里也可能带点（如
    // pages/my.vue/index.vue），如果按"第一次出现的位置"替换，目录名
    // 会被啃掉一块、真正的扩展名反而留着
    const ext = extname(path.relativePath)
    this.uri = normalizePath(ext ? path.relativePath.slice(0, -ext.length) : path.relativePath)
  }

  /**
   * 获取页面配置
   * 解析 definePage 宏定义的配置并返回用于 pages.json 的配置
   *
   * @param forceUpdate - 是否强制更新，忽略缓存
   * @returns 页面配置对象
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
   * 获取页面 tabBar 配置
   * 从 definePage 宏中提取 tabBar 相关配置
   *
   * @param forceUpdate - 是否强制更新，忽略缓存
   * @returns tabBar 配置对象，页面未定义 tabBar 时返回 undefined
   */
  public async getTabBar(forceUpdate = false): Promise<TabBarItem & { index: number } | undefined> {
    if (forceUpdate || !this.loaded) {
      await this.read()
    }

    // 通过 definePage(null) 退出的页面不提供 tabBar 项
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
   * 确保页面文件至少被读取过一次，使 `skipped` 与缓存的配置反映
   * 当前文件内容
   */
  public async ensureLoaded(): Promise<void> {
    if (!this.loaded)
      await this.read()
  }

  /**
   * 检查页面是否发生变化
   * @returns 页面是否发生变化
   */
  public hasChanged(): boolean {
    return this.changed
  }

  /**
   * 读取页面文件并解析配置
   * 从 Vue SFC 中提取 definePage 宏定义的配置
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
      // 光写进 debug 通道用户看不见：宏求值失败时页面退回默认配置，
      // 而转换阶段照样会把宏从产物里删掉，必须在正常输出里留下信号
      this.ctx.logger?.warn(err?.message ?? String(err), { timestamp: true })
      return // 读取失败时中断
    }

    let raw = ''
    try {
      // 页面被跳过时 JSON.stringify(undefined) 返回 undefined，
      // 统一换成空字符串，`raw` 就一直是字符串，变更检测才靠得住
      raw = JSON.stringify(meta) ?? ''
    }
    catch {
      // 忽略序列化错误
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
      // undefined 表示没有 definePage 宏：保留页面并使用默认配置。
      // null 是显式退出，必须原样传递给调用方。
      return meta === undefined ? { type: 'page' } : meta
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.relativePath}\n${err.message}`)
    }
  }
}
