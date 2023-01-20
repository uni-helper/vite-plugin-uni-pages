<!-- eslint-disable no-console -->
<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
onLaunch(() => {
  console.log('App Launch')
})
onShow(() => {
  console.log('App Show')
})
onHide(() => {
  console.log('App Hide')
})

const pages = getCurrentPages()
const page = pages[pages.length - 1]
console.log(page)
</script>

<style></style>
