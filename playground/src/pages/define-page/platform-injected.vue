<script lang="ts" setup>
definePage(({ platform }) => {
  // 使用注入的 platform 参数，无需手动读取 process.env.UNI_PLATFORM
  return {
    style: {
      navigationBarTitleText: `platform: ${platform}`,
    },
  };
});
</script>

<template>
  <div>define page using the injected platform argument</div>
</template>
