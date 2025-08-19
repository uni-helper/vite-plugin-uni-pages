<script lang="ts" setup></script>

<template>
  <div>test</div>
</template>

<route lang="jsonc">
{
  "style": {
    // #ifdef APP
    "navigationBarTitleText": "test jsonc page APP"
    // #endif
  },
  // #ifdef APP
  "enablePullDownRefresh": true
  // #endif
}
</route>
