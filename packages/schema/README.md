# @uni-helper/pages-json-schema

为 uni-app 的 `pages.json` 提供 schema

## 安装

```bash
pnpm add @uni-helper/pages-json-schema
```

## 用法

```js
import PagesSchema from '@uni-helper/pages-json-schema'

console.log(PagesSchema)

// {
//   "$ref": "#/definitions/PagesConfig",
//   "$schema": "http://json-schema.org/draft-07/schema#",
//   "definitions": {...}
// }
```
