import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/config/index.ts"],
  format: ["cjs", "esm"],
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node14",
  external: ["vite", "esbuild"],
  dts: true,
});
