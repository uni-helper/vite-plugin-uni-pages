# @uni-helper/volar-service-uni-pages

**仅支持 Volar v1，v2 支持受限，详见 [vuejs/language-tools#4709](https://github.com/vuejs/language-tools/issues/4709)**

为 `<route>` 块提供智能提示和自动补全。

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
