import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    UniPages({
      homePage: 'pages/index',
      debug: true,
      subPackages: ['src/pages-sub'],
    }),
    uni(),
  ],
})
