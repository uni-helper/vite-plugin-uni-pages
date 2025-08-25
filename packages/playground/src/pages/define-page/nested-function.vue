<script lang="ts" setup>
definePage(() => {
  function getTitle(): string {
    const hello = 'hello';
    const world = 'world';

    return [hello, world].join(' ');
  }

  return {
    style: {
      navigationBarTitleText: getTitle(),
    },
    middlewares: [
      'auth',
    ],
  };
});
</script>

<template>
  <div>test</div>
</template>
