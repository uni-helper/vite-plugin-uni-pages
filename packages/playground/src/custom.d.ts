import { PageMetaDatum as SPageMetaDatum } from '@uni-helper/vite-plugin-uni-pages';

export interface UniPagesRouteMeta {
  PageMetaDatum: Partial<SPageMetaDatum> & {
    /** 自定义属性 */
    customAttribute?: string
  }
}
