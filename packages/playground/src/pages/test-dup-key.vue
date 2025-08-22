<script lang="ts" setup></script>

<template>
  <div>test dup key</div>
</template>

<route lang="jsonc">
{
  "style": {
    // #ifdef APP
    "navigationBarTitleText": "[APP]test dup key page",
    // endif
    // #ifdef WEB
    "navigationBarTitleText__dup__1": "[WEB]test dup key page",
    // endif
    // #ifdef MP-WEIXIN
    "navigationBarTitleText__dup__2": "[MP-WEIXIN]test dup key page"
    // endif
  },
  // #ifdef APP
  "middlewares": ["app"],
  // endif
  // #ifdef WEB
  "middlewares__dup__1": ["web"],
  // endif
  // #ifdef MP-WEIXIN
  "middlewares__dup__2": ["weixin"]
  // endif
}
</route>
