import { createSSRApp } from "vue";
import App from "./App.vue";

const routerMethods = [
  "navigateTo",
  "redirectTo",
  "reLaunch",
  "switchTab",
  "navigateBack",
];

function testMiddleware(to: string, from: string): void | boolean | string {
  console.log(to, from);
}

routerMethods.forEach((method) => {
  uni.addInterceptor(method, {
    invoke(result) {
      const routerList = getCurrentPages();
      const from = routerList[routerList.length - 1];
      testMiddleware(result.url, from.route);
    },
  });
});

export function createApp() {
  const app = createSSRApp(App);
  return {
    app,
  };
}
