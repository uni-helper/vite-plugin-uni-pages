# @uni-helper/volar-service-uni-pages

为 `<route>` 块 提供 IntelliSense

## 安装

```bash
pnpm add -D @uni-helper/volar-service-uni-pages
```

## 用法

```js
// volar.config.js
const volarServiceUniPages = require('@uni-helper/volar-service-uni-pages')

module.exports = {
  services: [
    volarServiceUniPages(),
  ],
}
```
