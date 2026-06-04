/** Virtual module identifier for Vite module resolution */
export const MODULE_ID_VIRTUAL = 'virtual:uni-pages'

/** Resolved virtual module identifier with \0 prefix to avoid conflicts with other modules */
export const RESOLVED_MODULE_ID_VIRTUAL = `\0${MODULE_ID_VIRTUAL}`

/** Output filename, the uni-app page configuration file */
export const OUTPUT_NAME = 'pages.json'

/** Supported page file extensions */
export const FILE_EXTENSIONS = ['vue', 'nvue', 'uvue']
