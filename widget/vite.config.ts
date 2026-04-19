import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const widgetDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: widgetDir,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: path.resolve(widgetDir, "../dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(widgetDir, "todo-widget.html"),
    },
  },
});
