<script lang="ts" setup>
import type { HelloWorld } from './utils';

definePage(() => {
  const words: HelloWorld = {
    hello: 'hello',
    world: 'world',
  };

  return {
    style: {
      navigationBarTitleText: [words.hello, words.world].join(' '),
    },
    middlewares: [
      'auth',
    ],
  };
});
</script>

<template>
  <div>define page in function mode</div>
</template>
