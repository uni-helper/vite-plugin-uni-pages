<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: 'hello world',
  },
  middlewares: [
    'auth',
  ],
  tabBar: {},
});
</script>

<template>
  <div>test</div>
</template>
