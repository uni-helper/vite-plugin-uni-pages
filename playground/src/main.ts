import { createSSRApp } from "vue";
import App from "./App.vue";
import { pages } from "virtual:uni-pages";

console.log(pages);

export function createApp() {
  const app = createSSRApp(App);
  return {
    app,
  };
}
