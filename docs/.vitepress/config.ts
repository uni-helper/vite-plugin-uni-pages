import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Vite Plugin Uni Pages',
  description: '用 TypeScript 约定式生成 uni-app 的 pages.json。',
  lang: 'zh-CN',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'zh_cn' }],
    ['meta', { name: 'og:site_name', content: 'Vite Plugin Uni Pages' }],
    [
      'meta',
      {
        name: 'og:image',
        content: 'https://github.com/uni-helper/website/raw/main/.github/assets/uni-helper-banner.png',
      },
    ],
  ],
  themeConfig: {
    logo: { src: '/logo.svg', width: 24, height: 24 },
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: 'API', link: '/api/options' },
      {
        text: '更新日志',
        link: 'https://github.com/uni-helper/vite-plugin-uni-pages/releases',
      },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '介绍', link: '/guide/introduction' },
          { text: '起步', link: '/guide/installation' },
          { text: '使用', link: '/guide/usage' },
          { text: 'definePage', link: '/guide/define-page' },
          { text: 'pages.config', link: '/guide/pages-config' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: '插件选项', link: '/api/options' },
          { text: '生命周期钩子', link: '/api/hooks' },
          { text: 'prepare()', link: '/api/prepare' },
          { text: '虚拟模块', link: '/api/virtual-module' },
        ],
      },
      {
        text: '进阶',
        items: [
          { text: '多平台与条件编译', link: '/advanced/multi-platform' },
          { text: '分包', link: '/advanced/subpackages' },
          { text: '页面排除', link: '/advanced/exclude' },
          { text: '配置依赖热更新', link: '/advanced/config-dependencies' },
          { text: '监听与符号链接', link: '/advanced/watchers-and-symlinks' },
          { text: '会话与实例复用', link: '/advanced/lifecycle' },
          { text: '输出格式', link: '/advanced/formatting' },
        ],
      },
      {
        text: '其它',
        items: [
          { text: '常见问题', link: '/other/faq' },
          { text: '迁移指南', link: '/other/migration' },
          { text: '构建与兼容性', link: '/other/build' },
          { text: '致谢', link: '/other/thank' },
        ],
      },
    ],
    editLink: {
      pattern: 'https://github.com/uni-helper/vite-plugin-uni-pages/edit/main/docs/:path',
    },
    lastUpdated: {},
    socialLinks: [
      { icon: 'github', link: 'https://github.com/uni-helper/vite-plugin-uni-pages' },
    ],
    search: {
      provider: 'local',
    },
  },
})
