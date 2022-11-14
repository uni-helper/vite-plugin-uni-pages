import { resolve } from "path";
import { ResolvedOptions } from "./types";
import { createFilter } from "vite";
export const isPagePath = (path: string, options: ResolvedOptions) => {
  const dirPath = resolve(process.cwd(), options.pagesDir);
  const filter = createFilter(dirPath + "/**/*.(vue|nvue)");
  return filter(path);
  // if (path.startsWith(dirPath)) return true;
  // return false;
};
