/** Vite 模块解析用的虚拟模块标识 */
export const MODULE_ID_VIRTUAL = 'virtual:uni-pages'

/** 加 \0 前缀解析后的虚拟模块标识，避免与其他模块冲突 */
export const RESOLVED_MODULE_ID_VIRTUAL = `\0${MODULE_ID_VIRTUAL}`

/** 输出文件名，即 uni-app 的页面配置文件 */
export const OUTPUT_NAME = 'pages.json'

/** 支持的页面文件扩展名 */
export const FILE_EXTENSIONS = ['vue', 'nvue', 'uvue']
