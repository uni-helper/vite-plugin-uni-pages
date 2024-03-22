<script lang="ts" setup>
import { randamText } from './utils';

definePage(() => {
  return {
    style: {
      navigationBarTitleText: randamText()
    }
  }
})
</script>

<template>
  <div>test</div>
</template>
