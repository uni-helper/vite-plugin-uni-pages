import { normalizePath, Plugin } from "vite";
import { PageMeta, PagePathInfo, ResolvedOptions, UserOptions } from "./types";
import { loadConfig } from "unconfig";
import { PagesConfig } from "./config";
import { basename, extname, join, relative, resolve } from "path";
import fs from "fs";
import fg from "fast-glob";
import { isPagePath } from "./utils";
import { parse } from "@vue/compiler-dom";
import { parse as JSONParse } from "jsonc-parser";
import { defu } from "defu";

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

const scanPages = async (options: ResolvedOptions): Promise<PagePathInfo[]> => {
  const files = await fg("**/*.(vue|nvue)", {
    ignore: ["node_modules", ".git", "**/__*__/*"],
    onlyFiles: true,
    cwd: resolve(process.cwd(), options.pagesDir),
  });
  const basePath = relative(
    resolve(process.cwd(), options.outDir),
    options.pagesDir
  );
  return files.map((file) => {
    return {
      relative: normalizePath(join(basePath, file)),
      absolute: normalizePath(resolve(process.cwd(), options.pagesDir, file)),
    };
  });
};

const parsePage = async ({
  relative,
  absolute,
}: PagePathInfo): Promise<PageMeta> => {
  const code = await fs.promises.readFile(absolute, {
    encoding: "utf-8",
  });
  const t = parse(code);
  const path = relative.replace(extname(relative), "");
  let pageMeta: PageMeta = {
    path,
    type: "page",
  };
  t?.children.forEach((v) => {
    if (v.type !== 1) {
      return;
    }
    if (v.tag === "route") {
      v.props.forEach((prop) => {
        if (prop.type === 6 && prop.name === "type") {
          pageMeta.type = prop.value?.content ?? pageMeta.type;
        }
      });
      const astContent = v.children?.[0];
      if (astContent && astContent.type === 2) {
        const _pageMeta = JSONParse(astContent.content);
        Object.keys(_pageMeta).forEach((key) => {
          pageMeta[key] = _pageMeta[key];
        });
        // overwrite path
        pageMeta["path"] = path;
      }
    }
  });
  return pageMeta;
};

const createOrUpdatePagesJSON = async (
  options: ResolvedOptions,
  path?: string
) => {
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
  const pagesPathList = await scanPages(options);
  const pagesMeta = await Promise.all(
    pagesPathList.map(async (page) => await parsePage(page))
  );

  const pages = Object.values(defu({}, pagesMeta, config.pages));

  // @ts-ignore
  pages.sort((a) => (a.type === "home" ? -1 : 0));
  config.pages = pages;

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
        if (
          normalizePath(path) === pagesConfigSource ||
          isPagePath(path, options)
        ) {
          await createOrUpdatePagesJSON(options);
        }
      });
      watcher.on("add", async (path) => {
        if (isPagePath(path, options)) {
          await createOrUpdatePagesJSON(options);
        }
      });
      watcher.on("unlink", async (path) => {
        if (isPagePath(path, options)) {
          await createOrUpdatePagesJSON(options);
        }
      });
    },
  };
};

export default VitePluginUniPages;
