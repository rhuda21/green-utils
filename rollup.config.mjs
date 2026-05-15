import { defineConfig } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default defineConfig({
  input: "src/index.ts", // Points directly to your new TypeScript file
  output: {
    file: "dist/index.js",
    format: "iife",
    compact: true,
  },
  plugins: [
    nodeResolve(),
    commonjs(),
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