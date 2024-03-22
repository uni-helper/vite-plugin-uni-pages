<script lang="ts" setup>
definePage(() => {

  const hello = 'hello'

  const world = 'world'

  return {
    style: {
      navigationBarTitleText: [hello, world].join(' ')
    },
    middlewares: [
      'auth'
    ]
  }
})
</script>

<template>
  <div>test</div>
</template>
