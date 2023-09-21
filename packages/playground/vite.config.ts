import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import type { PagesConfig } from '@uni-helper/vite-plugin-uni-pages'
import UniPages from '@uni-helper/vite-plugin-uni-pages'

declare module 'vite' {
  interface UserConfig {
    UniPages?: PagesConfig
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    UniPages({
      dts: 'src/uni-pages.d.ts',
      homePage: 'pages/index',
      debug: true,
      subPackages: ['src/pages-sub'],
      // configSource: [
      //   {
      //     files: 'vite.config',
      //     async rewrite(config) {
      //       const resolved = await (typeof config === 'function' ? config() : config)
      //       return resolved?.UniPages
      //     },
      //   },
      // ],
    }),
    uni(),
  ],
  UniPages: {
    globalStyle: {
      navigationBarTextStyle: 'black',
      navigationBarTitleText: 'uni-helper - vite.config.ts',
      navigationBarBackgroundColor: '#F8F8F8',
      backgroundColor: '#F8F8F8',
    },
  },
})
