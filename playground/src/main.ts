import { createSSRApp } from 'vue'
import { pages } from 'virtual:uni-pages'
import App from './App.vue'

// eslint-disable-next-line no-console
console.log(pages)

export function createApp() {
  const app = createSSRApp(App)
  return {
    app,
  }
}
