<script lang="ts" setup></script>

<template>
  <div>test</div>
</template>

<route lang="jsonc">
{
  "style": {
    // #ifdef H5
    "navigationBarTitleText": "test jsonc page H5"
    // #endif
  },
  // #ifdef H5
  "enablePullDownRefresh": true
  // #endif
}
</route>
