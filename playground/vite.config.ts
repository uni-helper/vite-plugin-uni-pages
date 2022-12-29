import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [UniPages(), uni()],
})
