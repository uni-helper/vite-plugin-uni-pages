import type { Pages } from './pages'

export interface SubPackage {
  /**
   * 子包的根目录
   */
  root: string

  /**
   * 子包由哪些页面组成，参数同 pages
   */
  pages: Pages

  /**
   * 分包插件
   */
  plugins?: {
    [pluginName: string]: {
      version: string

      provider: string

      export?: string

      [key: string]: any
    }
  }
}

export type SubPackages = SubPackage[]
