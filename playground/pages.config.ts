import { definePages } from "@uni-helper/vite-plugin-uni-pages";

export default definePages({
  pages: [
    {
      path: "pages/index",
      style: {
        navigationBarTitleText: "index",
      },
    },
    {
      path: "pages/test",
      style: {
        navigationBarTitleText: "test",
      },
    },
  ],
  globalStyle: {
    navigationBarTextStyle: "black",
    navigationBarTitleText: "@uni-helper",
    navigationBarBackgroundColor: "#F8F8F8",
    backgroundColor: "#F8F8F8",
  },
});
