import type { PageMetaDatum } from '../../types'

export interface SubPackage {
  /**
   * 子包的根目录
   */
  root: string

  /**
   * 子包由哪些页面组成，参数同 pages
   */
  pages: PageMetaDatum[]

  /**
   * 分包插件
   */
  plugins?: {
    [pluginName: string]: {
      version: string

      provider: string

      [key: string]: any
    }
  }
}

export type SubPackages = SubPackage[]
