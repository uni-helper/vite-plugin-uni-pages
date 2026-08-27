import { pages, subPackages } from 'virtual:uni-pages'
import { createSSRApp } from 'vue'
import App from './App.vue'

// eslint-disable-next-line no-console
console.log(pages, subPackages)

// eslint-disable-next-line ts/explicit-function-return-type
export function createApp() {
  const app = createSSRApp(App)
  return {
    app,
  }
}
