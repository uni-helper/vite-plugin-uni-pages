---
layout: home

hero:
  name: Vite Plugin Uni Pages
  tagline: 在 Vite 驱动的 uni-app 里，用 TypeScript 约定式地生成 pages.json。
  actions:
    - theme: brand
      text: 起步
      link: /guide/installation
    - theme: alt
      text: 介绍
      link: /guide/introduction
  image:
    src: /logo.svg
    alt: Vite Plugin Uni Pages

features:
  - title: 约定式路由
    details: 扫描页面目录自动生成 pages.json，新增、删除、重命名文件都会同步更新。
  - title: definePage 宏
    details: 页面配置写在页面文件里，支持函数式写法、按平台分支和 definePage(null) 跳过。
  - title: TypeScript 配置
    details: 用 pages.config.ts 编写全局配置，defineUniPages 提供完整的类型提示。
  - title: 多平台合并
    details: 多个平台的终端共用一个 pages.json，条目按 #ifdef 条件编译块分别保存。
  - title: 自动发现分包
    details: 分包目录支持 glob 和 root 回调，开发期间新增、删除、重命名目录无需重启。
  - title: 类型安全
    details: 生成 uni-pages.d.ts 约束导航 API 的 URL，虚拟模块提供页面元数据。
---

<!-- markdownlint-disable -->
<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(
    315deg,
    #42d392 25%,
    #647eff
  );
  --vp-home-hero-image-background-image: linear-gradient(
    -45deg,
    #2b993980 30%,
    #35495e80
  );
  --vp-home-hero-image-filter: blur(30px);
}

@media (min-width: 640px) {
  :root {
    --vp-home-hero-image-filter: blur(56px);
  }
}

@media (min-width: 960px) {
  :root {
    --vp-home-hero-image-filter: blur(68px);
  }
}
</style>
<!-- markdownlint-disable -->
