<script lang="ts" setup>
definePage(async () => {
  let title = await new Promise<string>((resolve) => {
    resolve('hello world');
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
