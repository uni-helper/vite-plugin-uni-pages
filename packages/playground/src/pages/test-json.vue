<script lang="ts" setup></script>

<template>
  <div>test</div>
</template>

<route type="home" lang="jsonc">
{
  "style": {
    "navigationBarTitleText": "test json page"
  },
  "middlewares": [
    "auth"
  ]
}
</route>
