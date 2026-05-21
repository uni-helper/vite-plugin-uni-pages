<script lang="ts" setup>
definePage(async () => {
  let title = await new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve('hello world');
    }, 100);
  });

  return {
    style: {
      navigationBarTitleText: title,
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
