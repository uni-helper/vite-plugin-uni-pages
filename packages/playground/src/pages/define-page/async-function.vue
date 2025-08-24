<script lang="ts" setup>
definePage(async () => {
  const randomTxt = await new Promise<string>((resolve) => {
    const txt = Math.random().toString(36).slice(-8);
    resolve(txt);
  });

  return {
    style: {
      navigationBarTitleText: randomTxt,
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
