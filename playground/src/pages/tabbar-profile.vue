<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: '我的',
  },
  tabBar: {
    text: '我的',
    iconPath: 'static/moon.png',
    selectedIconPath: 'static/sun.png',
    index: 2,
  },
});
</script>

<template>
  <div>tabbar profile page</div>
</template>
