import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/build/" : "/",
  plugins: [react()],
  publicDir: false,
  test: { include: ["resources/js/**/*.{test,spec}.{ts,tsx}"] },
  build: {
    outDir: "public/build",
    emptyOutDir: true,
    manifest: "manifest.json",
    rollupOptions: {
      input: ["resources/js/main.tsx", "resources/js/versionShareMain.tsx"],
      output: {
        entryFileNames: "assets/app-[hash].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
