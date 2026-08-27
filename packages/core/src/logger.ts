import Debug from 'debug'

/**
 * 调试日志工具
 * 基于 debug 包做分级日志输出
 * 通过环境变量 DEBUG=vite-plugin-uni-pages:* 开启
 */
export const debug = {
  /** HMR 相关日志 */
  hmr: Debug('vite-plugin-uni-pages:hmr'),
  /** 配置项相关日志 */
  options: Debug('vite-plugin-uni-pages:options'),
  /** 主包页面扫描日志 */
  pages: Debug('vite-plugin-uni-pages:pages'),
  /** 子包页面扫描日志 */
  subPages: Debug('vite-plugin-uni-pages:subPages'),
  /** 错误日志 */
  error: Debug('vite-plugin-uni-pages:error'),
  /** 缓存相关日志 */
  cache: Debug('vite-plugin-uni-pages:cache'),
  /** 声明文件生成日志 */
  declaration: Debug('vite-plugin-uni-pages:declaration'),
  /** definePage 宏解析日志 */
  definePage: Debug('vite-plugin-uni-pages:definePage'),
}
