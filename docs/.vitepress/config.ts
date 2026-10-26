import { defineConfig } from 'vitepress'

/**
 * 侧边栏版本徽标。VPSidebarItem 用 v-html 渲染 item.text，这里的 HTML
 * 会按 Badge 组件的样式显示；样式调整在 theme/custom.css。
 */
function versionBadge(version: string, type: 'tip' | 'warning' = 'tip'): string {
  return `<span class="VPBadge ${type}">${version}</span>`
}

const docsSidebar = [
  {
    text: '指南',
    items: [
      { text: '介绍', link: '/guide/introduction' },
      { text: '起步', link: '/guide/installation' },
      { text: '使用', link: '/guide/usage' },
      { text: `definePage ${versionBadge('v0.4.0')}`, link: '/guide/define-page' },
      { text: 'pages.config', link: '/guide/pages-config' },
    ],
  },
  {
    text: 'API',
    items: [
      { text: '插件选项', link: '/api/options' },
      { text: `生命周期钩子 ${versionBadge('v0.0.3')}`, link: '/api/hooks' },
      { text: `prepare() ${versionBadge('v0.6.0')}`, link: '/api/prepare' },
      { text: '虚拟模块', link: '/api/virtual-module' },
    ],
  },
  {
    text: '进阶',
    items: [
      { text: `多平台与条件编译 ${versionBadge('v0.5.0')}`, link: '/advanced/multi-platform' },
      { text: `分包 ${versionBadge('v0.1.8')}`, link: '/advanced/subpackages' },
      { text: `页面排除 ${versionBadge('v0.0.4')}`, link: '/advanced/exclude' },
      { text: `配置依赖热更新 ${versionBadge('v0.6.0')}`, link: '/advanced/config-dependencies' },
      { text: `监听与符号链接 ${versionBadge('v0.6.0', 'warning')}`, link: '/advanced/watchers-and-symlinks' },
      { text: `会话与实例复用 ${versionBadge('v0.6.0')}`, link: '/advanced/lifecycle' },
      { text: `输出格式 ${versionBadge('v0.5.0')}`, link: '/advanced/formatting' },
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
]

const blogSidebar = [
  {
    text: '博客',
    items: [
      { text: '全部文章', link: '/blog/' },
      {
        text: '0.6：统一扫描规则，开发期少重启',
        link: '/blog/2026-10-26-vite-plugin-uni-pages-0-6',
      },
      {
        text: 'vite-plugin-uni-pages 更新了什么',
        link: '/blog/2026-09-04-vite-plugin-uni-pages-0-4-0-5',
      },
    ],
  },
]

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
      { text: '指南', link: '/guide/introduction', activeMatch: '/(guide|api|advanced|other)/' },
      { text: '博客', link: '/blog/', activeMatch: '/blog/' },
      {
        text: '更新日志',
        link: 'https://github.com/uni-helper/vite-plugin-uni-pages/releases',
      },
    ],
    sidebar: {
      '/': docsSidebar,
      '/blog/': blogSidebar,
    },
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
