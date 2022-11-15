import { extname, join, relative, resolve } from "path";
import { loadConfig } from "unconfig";
import { normalizePath } from "vite";
import { PagesConfig } from "../config/types";
import { PageMeta, PagePathInfo, ResolvedOptions } from "../types";
import fg from "fast-glob";
import { parse as JSONParse } from "jsonc-parser";
import { parse } from "@vue/compiler-dom";
import fs from "fs";
import { defu } from "defu";
import { logger } from "../utils";

export class Context {
  options: ResolvedOptions;
  pagesConfig!: PagesConfig;
  pagesPathInfo: PagePathInfo[] = [];
  pagesMeta: PageMeta[] = [];
  constructor(options: ResolvedOptions) {
    this.options = options;
    this.createOrUpdatePagesJSON();
  }

  async loadUserPagesConfig() {
    const { config } = await loadConfig({
      sources: [
        {
          files: this.options.entry,
          extensions: [this.options.extension],
        },
      ],
      merge: false,
    });
    logger.debug("Loaded user pages config", config);
    this.pagesConfig = config as PagesConfig;
  }

  async scanPages() {
    const files = await fg("**/*.(vue|nvue)", {
      ignore: ["node_modules", ".git", "**/__*__/*"],
      onlyFiles: true,
      cwd: resolve(process.cwd(), this.options.pagesDir),
    });
    const basePath = relative(
      resolve(process.cwd(), this.options.outDir),
      this.options.pagesDir
    );
    this.pagesPathInfo = files.map((file) => {
      return {
        relative: normalizePath(join(basePath, file)),
        absolute: normalizePath(
          resolve(process.cwd(), this.options.pagesDir, file)
        ),
      };
    });
    logger.debug("Scanned pages dir", this.pagesPathInfo);
  }

  async parsePage({ relative, absolute }: PagePathInfo): Promise<PageMeta> {
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
  }

  async mergePagesMeta() {
    const pagesMeta = await Promise.all(
      this.pagesPathInfo?.map(async (page) => await this.parsePage(page))
    );
    const pages = Object.values(defu({}, pagesMeta, this.pagesConfig.pages));
    // @ts-ignore
    pages.sort((a) => (a.type === "home" ? -1 : 0));
    // @ts-ignore
    this.pagesMeta = pages;
    logger.debug("merged pages", this.pagesMeta);
  }

  async createOrUpdatePagesJSON() {
    const outputName = "pages.json";
    const resolvedOutput = normalizePath(
      resolve(process.cwd(), this.options.outDir, outputName)
    );

    // 如果不存在，先输出一个占位文件
    if (!fs.existsSync(resolvedOutput)) {
      fs.writeFileSync(resolvedOutput, `{"pages": [{"path": ""}]}`, {
        encoding: "utf-8",
      });
    }

    await this.loadUserPagesConfig();
    await this.scanPages();
    await this.mergePagesMeta();

    fs.writeFileSync(
      resolvedOutput,
      JSON.stringify({
        ...this.pagesConfig,
        pages: this.pagesMeta,
      }),
      {
        encoding: "utf-8",
      }
    );
  }

  async virtualModule() {
    return `export const pages = ${JSON.stringify(this.pagesMeta)};`;
  }

  get pagesConfigSourcePath() {
    return normalizePath(
      resolve(process.cwd(), `${this.options.entry}.${this.options.extension}`)
    );
  }
}
