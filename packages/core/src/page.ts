import type { TabBarItem } from '@uni-helper/uni-pages-types'
import type { Logger } from 'vite'
import type { InternalPageItem, PagePath, UserPageItem } from './types'
import fs from 'node:fs'
import { extname } from 'node:path'
import { normalizePath } from 'vite'
import { debug } from './logger'
import { evaluateDefinePage } from './macro'

/** Page 读取页面内容所需的环境；不再依赖整个 PageContext */
export interface PageEnvironment {
  platform: string
  /** 读取时取得当前 logger，覆盖 setLogger 在 Page 创建之后才发生的情况 */
  getLogger?: () => Logger | undefined
}

/** 一次页面读取的结果；缓存和变更检测都留在 Page 内部 */
export interface PageSnapshot {
  /** 用于合并的页面元数据，path 已按 uri 补齐 */
  meta: InternalPageItem
  /** definePage 声明的 tabBar 项，已补齐 pagePath 和 index */
  tabBar?: TabBarItem & { index: number }
  /** 页面在当前平台通过 definePage(null) 退出 */
  skipped: boolean
  /** 与上一次成功读取相比内容或跳过状态是否变化 */
  changed: boolean
}

/**
 * 表示一个 Vue 页面文件的读取适配器
 *
 * 调用方只需要 `load()`：文件读取、宏求值、跳过状态、tabBar 补全和
 * 变更检测都在快照里返回。`getPageMeta` / `getTabBar` 保留为兼容入口。
 */
export class Page {
  /** 页面路径信息，包含相对路径与绝对路径 */
  path: PagePath
  /** 页面 URI，用于 pages.json 的 path 字段 */
  uri: string

  private snapshot: PageSnapshot | undefined
  /** 当前读取缓存是否有效 */
  private loaded = false
  /** 当前缓存是否已尝试读取；失败后等下次失效再重试 */
  private readAttempted = false
  /** 上一次成功读取的配置，用于变更检测 */
  private raw = ''

  constructor(
    private readonly environment: PageEnvironment,
    path: PagePath,
  ) {
    this.path = path
    // 只从路径末尾剥掉扩展名。目录名里也可能带点（如
    // pages/my.vue/index.vue），如果按"第一次出现的位置"替换，目录名
    // 会被啃掉一块、真正的扩展名反而留着
    const ext = extname(path.relativePath)
    this.uri = normalizePath(ext ? path.relativePath.slice(0, -ext.length) : path.relativePath)
  }

  /** 页面是否通过 definePage(null) 退出 */
  get skipped(): boolean {
    return this.snapshot?.skipped ?? false
  }

  /** 页面内容是否相对上次成功读取发生变化 */
  get changed(): boolean {
    return this.snapshot?.changed ?? true
  }

  /**
   * 读取页面并返回快照
   *
   * @param forceUpdate - 忽略缓存强制重读
   */
  async load(forceUpdate = false): Promise<PageSnapshot> {
    if (forceUpdate || (!this.loaded && !this.readAttempted))
      await this.read()
    return this.snapshot ?? this.fallbackSnapshot()
  }

  /**
   * 获取页面配置，保留给既有调用方
   *
   * 返回副本：合并阶段会原地写 `type: 'home'`，不能让首页标记留在
   * 读取快照里，否则增量更新会继续把旧首页当成首页。
   */
  async getPageMeta(forceUpdate = false): Promise<InternalPageItem> {
    return { ...(await this.load(forceUpdate)).meta }
  }

  /** 获取 tabBar 项，保留给既有调用方 */
  async getTabBar(forceUpdate = false): Promise<TabBarItem & { index: number } | undefined> {
    return (await this.load(forceUpdate)).tabBar
  }

  /** 加载尚未读取的页面配置，缓存失效前不重复尝试失败的读取 */
  async ensureLoaded(): Promise<void> {
    await this.load()
  }

  /**
   * 使页面读取缓存失效
   *
   * @description 下次访问时重新读取，保留上次成功快照作为读取失败时的回退
   */
  invalidate(): void {
    this.loaded = false
    this.readAttempted = false
  }

  /** 检查页面是否发生变化 */
  hasChanged(): boolean {
    return this.changed
  }

  /**
   * 读取页面文件并解析配置
   *
   * @description 成功后替换快照；失败时保留上次成功快照，只记录警告
   */
  async read(): Promise<void> {
    this.readAttempted = true
    let meta: UserPageItem | undefined
    let skipped = false
    try {
      const result = await this.readPageMetaFromFile()
      if (result === null)
        skipped = true
      else
        meta = result
    }
    catch (err: any) {
      debug.error(err)
      // 光写进 debug 通道用户看不见：宏求值失败时页面退回默认配置，
      // 而转换阶段照样会把宏从产物里删掉，必须在正常输出里留下信号
      const logger = this.environment.getLogger?.()
      logger?.warn(err?.message ?? String(err), { timestamp: true })
      return
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

    const changed = this.raw !== raw || this.skipped !== skipped
    this.raw = raw
    this.loaded = true
    this.snapshot = this.createSnapshot(meta, skipped, changed)
  }

  private createSnapshot(meta: UserPageItem | undefined, skipped: boolean, changed: boolean): PageSnapshot {
    const { path, tabBar, ...others } = meta ?? {}
    return {
      meta: { path: path ?? this.uri, ...others },
      tabBar: !skipped && tabBar
        ? { ...tabBar, pagePath: tabBar.pagePath || this.uri, index: tabBar.index ?? 0 }
        : undefined,
      skipped,
      changed,
    }
  }

  /** 读取失败且从未成功时的默认快照，保持页面仍以 uri 参与生成 */
  private fallbackSnapshot(): PageSnapshot {
    return {
      meta: { path: this.uri },
      tabBar: undefined,
      skipped: false,
      changed: true,
    }
  }

  private async readPageMetaFromFile(): Promise<UserPageItem | null> {
    try {
      const content = await fs.promises.readFile(this.path.absolutePath, { encoding: 'utf-8' })
      const meta = await evaluateDefinePage(content, this.path.absolutePath, this.environment.platform)
      // undefined 表示没有 definePage 宏：保留页面并使用默认配置。
      // null 是显式退出，必须原样传递给调用方。
      return meta === undefined ? { type: 'page' } : meta
    }
    catch (err: any) {
      throw new Error(`Read page meta fail in ${this.path.relativePath}\n${err.message}`)
    }
  }
}
