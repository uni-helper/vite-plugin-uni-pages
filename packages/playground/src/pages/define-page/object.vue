<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: 'hello world',
  },
  middlewares: [
    'auth',
  ],
  tabbar: {},
});
</script>

<template>
  <div>test</div>
</template>
