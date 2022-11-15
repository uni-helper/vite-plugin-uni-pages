import { normalizePath, Plugin } from "vite";
import { ResolvedOptions, UserOptions } from "./types";
import { isPagePath } from "./utils";
import { virtualModuleId, resolvedVirtualModuleId } from "./constant";
import { Context } from "./context";

export * from "./config";

function resolveOptions(userOptions: UserOptions): ResolvedOptions {
  return {
    pagesDir: "src/pages",
    outDir: "src",
    entry: "pages.config",
    extension: "ts",
    middlewaresDir: "src/middlewares",
    ...userOptions,
  };
}

export const VitePluginUniPages = async (
  userOptions: UserOptions = {}
): Promise<Plugin> => {
  const options = resolveOptions(userOptions);
  const ctx = new Context(options);

  return {
    name: "vite-plugin-uni-pages",
    enforce: "pre",
    configureServer({ watcher }) {
      watcher.add(ctx.pagesConfigSourcePath);
      watcher.on("change", async (path) => {
        if (
          normalizePath(path) === ctx.pagesConfigSourcePath ||
          isPagePath(path, options)
        ) {
          await ctx.createOrUpdatePagesJSON();
        }
      });
      watcher.on("add", async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON();
        }
      });
      watcher.on("unlink", async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON();
        }
      });
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },

    load(id) {
      if (id === resolvedVirtualModuleId) {
        return ctx.virtualModule();
      }
    },
  };
};

export default VitePluginUniPages;
