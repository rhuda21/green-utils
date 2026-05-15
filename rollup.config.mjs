import { defineConfig } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import nodeResolve from "@rollup/plugin-node-resolve";

export default defineConfig({
  input: "src/index.js",
  output: {
    file: "dist/index.js",
    format: "iife",
    compact: true,
  },
  plugins: [
    nodeResolve(),
    esbuild({
      minify: true,
      target: "es2020",
      jsx: "transform",
    }),
  ],
  external: [
    /^@vendetta/,
    /^@bunny/
  ],
});