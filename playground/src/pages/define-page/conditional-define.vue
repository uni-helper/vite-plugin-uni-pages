<script lang="ts" setup>
// 使用注入的 define 工厂做平台条件编译，无需手动判断 platform
definePage(({ define }) =>
  define({ style: { navigationBarTitleText: 'conditional base' } })
    .ifdef('mp-weixin', { style: { navigationBarBackgroundColor: '#07c160' } })
    .ifndef('h5', { style: { enablePullDownRefresh: true } }),
);
</script>

<template>
  <div>define page with conditional DSL</div>
</template>
