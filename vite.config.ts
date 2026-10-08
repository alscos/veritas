import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/build/" : "/",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "public/build",
    emptyOutDir: true,
    manifest: "manifest.json",
    rollupOptions: {
      input: "resources/js/main.tsx",
      output: {
        entryFileNames: "assets/app-[hash].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
