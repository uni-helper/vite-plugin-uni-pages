<script lang="ts" setup>
definePage(() => {
  console.log('abc ...'); // this is console should be remove
  return {
    style: {
      navigationBarTitleText: 'this is a title',
    },
  };
});
</script>

<template>
  <div>remove-console</div>
</template>
