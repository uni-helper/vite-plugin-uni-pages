<script lang="ts" setup>
import { isH5 } from '@uni-helper/uni-env'

definePage(() => {
  const style: Record<string, any> = {
    navigationBarTitleText: 'test jsonc page',
  }

  if (isH5) {
    style.navigationBarTitleText = 'test jsonc page H5'
  }

  return {
    style,
    enablePullDownRefresh: isH5,
  }
})
</script>

<template>
  <div>test</div>
</template>
