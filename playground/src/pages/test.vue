<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: 'test page',
  },
  middlewares: [
    'auth',
  ],
})
</script>

<template>
  <div>test</div>
</template>
