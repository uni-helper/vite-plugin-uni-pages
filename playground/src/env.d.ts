/// <reference types="vite/client" />
/// <reference types="@uni-helper/vite-plugin-uni-pages/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, any>
  export default component
}
