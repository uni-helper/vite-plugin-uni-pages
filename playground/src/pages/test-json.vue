<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: 'test json page',
  },
  middlewares: [
    'auth',
  ],
})
</script>

<template>
  <div>test</div>
</template>
