import { ModuleNode, normalizePath, Plugin } from "vite";
import { ResolvedOptions, UserOptions } from "./types";
import { isPagePath, logger } from "./utils";
import { virtualModuleId, resolvedVirtualModuleId } from "./constant";
import { Context } from "./context";
import { existsSync } from "fs";

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
  logger.debug("Create uni-pages context with", options);
  const ctx = new Context(options);
  if (!existsSync(ctx.pagesConfigSourcePath)) {
    logger.error(`Can't found ${options.entry}.${options.extension}`);
  }
  return {
    name: "vite-plugin-uni-pages",
    enforce: "pre",
    configureServer({ watcher, moduleGraph, ws }) {
      logger.debug("Add watcher", ctx.pagesConfigSourcePath);
      watcher.add(ctx.pagesConfigSourcePath);

      const reloadModule = (module: ModuleNode | undefined, path = "*") => {
        if (module) {
          moduleGraph.invalidateModule(module);
          if (ws) {
            ws.send({
              path,
              type: "full-reload",
            });
          }
        }
      };
      const updateVirtualModule = () => {
        logger.debug("Update virtualModule");
        const module = moduleGraph.getModuleById(resolvedVirtualModuleId);
        reloadModule(module);
      };

      watcher.on("change", async (path) => {
        if (
          normalizePath(path) === ctx.pagesConfigSourcePath ||
          isPagePath(path, options)
        ) {
          await ctx.createOrUpdatePagesJSON();
          updateVirtualModule();
        }
      });
      watcher.on("add", async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON();
          updateVirtualModule();
        }
      });
      watcher.on("unlink", async (path) => {
        if (isPagePath(path, options)) {
          await ctx.createOrUpdatePagesJSON();
          updateVirtualModule();
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
