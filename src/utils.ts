import { resolve } from "path";
import { ResolvedOptions } from "./types";
import { createFilter } from "vite";
import consola from "consola";

export const isPagePath = (path: string, options: ResolvedOptions) => {
  const dirPath = resolve(process.cwd(), options.pagesDir);
  const filter = createFilter(dirPath + "/**/*.(vue|nvue)");
  return filter(path);
};

export const logger = consola.create({
  defaults: {
    tag: "vite-plugin-uni-pages",
  },
});
