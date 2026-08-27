<script lang="ts" setup>
definePage(({ platform }) => {
  // 在 mp-weixin 平台不生成该页面的 pages.json 条目
  if (platform === 'mp-weixin') {
    return null;
  }

  return {
    style: {
      navigationBarTitleText: 'skip on mp-weixin',
    },
  };
});
</script>

<template>
  <div>define page returning null on some platform</div>
</template>
