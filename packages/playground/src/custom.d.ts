import { PageMetaDatum as IPageMetaDatum } from '@uni-helper/vite-plugin-uni-pages';

interface PageMeta {
  /** 自定义属性 */
  customAttribute?: string
}

interface ExtraPageMetaDatum extends PageMeta, Partial<IPageMetaDatum> { }

declare module '@uni-helper/vite-plugin-uni-pages' {
  interface PageMetaDatum extends PageMeta { }
}
