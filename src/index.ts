import { normalizePath, Plugin } from "vite";
import { ResolvedOptions, UserOptions } from "./types";
import { loadConfig } from "unconfig";
import { PagesConfig } from "./config";
import { resolve } from "path";
import fs from "fs";

export * from "./config";
export * from "./middleware";

function resolveOptions(userOptions: UserOptions): ResolvedOptions {
  return {
    pagesDir: "src/pages",
    outDir: "src",
    entry: "pages.config",
    extension: "ts",
    ...userOptions,
  };
}

const loadUserPagesConfig = async (options: ResolvedOptions) => {
  const { config } = await loadConfig({
    sources: [
      {
        files: options.entry,
        extensions: [options.extension],
      },
    ],
    merge: false,
  });
  return config as PagesConfig;
};

const createOrUpdatePagesJSON = async (options: ResolvedOptions) => {
  const outputName = "pages.json";
  const resolvedOutput = normalizePath(
    resolve(process.cwd(), options.outDir, outputName)
  );

  // 如果不存在，先输出一个占位文件
  if (!fs.existsSync(resolvedOutput)) {
    fs.writeFileSync(resolvedOutput, "{}", {
      encoding: "utf-8",
    });
  }

  const config = await loadUserPagesConfig(options);

  fs.writeFileSync(resolvedOutput, JSON.stringify(config), {
    encoding: "utf-8",
  });
};

export const VitePluginUniPages = async (
  userOptions: UserOptions = {}
): Promise<Plugin> => {
  const options = resolveOptions(userOptions);
  const pagesConfigSource = normalizePath(
    resolve(process.cwd(), `${options.entry}.${options.extension}`)
  );
  await createOrUpdatePagesJSON(options);
  return {
    name: "vite-plugin-uni-pages",
    enforce: "pre",
    configureServer({ watcher }) {
      watcher.add(pagesConfigSource);
      watcher.on("change", async (path) => {
        if (normalizePath(path) === pagesConfigSource) {
          await createOrUpdatePagesJSON(options);
        }
      });
    },
  };
};

export default VitePluginUniPages;
