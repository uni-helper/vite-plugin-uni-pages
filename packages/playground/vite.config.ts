import type { PagesConfig } from '@uni-helper/vite-plugin-uni-pages'
import uni from '@dcloudio/vite-plugin-uni'
import UniPages from '@uni-helper/vite-plugin-uni-pages'
import { defineConfig } from 'vite'

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
      subPackages: ['src/pages-sub', 'src/pages-sub2'],
      exclude: [
        'pages*/**/components/**/*.*', // 排除所有pages 里面的 components 文件夹
        '!pages-sub2/**/components/**/*.*', // 不排除 pages-sub2/**/components
      ],
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
