import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const widgetDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // vite-plugin-singlefile requires one HTML entry per build.
  const isStats = mode === "stats";
  return {
    root: widgetDir,
    plugins: [react(), viteSingleFile()],
    build: {
      outDir: path.resolve(widgetDir, "../dist"),
      emptyOutDir: !isStats,
      rollupOptions: {
        input: path.resolve(widgetDir, isStats ? "stats-widget.html" : "todo-widget.html"),
      },
    },
  };
});
