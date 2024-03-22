<script lang="ts" setup>
definePage({
  style: {
    navigationBarTitleText: 'hello world'
  },
  middlewares: [
    'auth'
  ]
})
</script>

<template>
  <div>test</div>
</template>
