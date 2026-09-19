import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "public/build",
    emptyOutDir: true,
    rollupOptions: {
      input: "resources/js/main.tsx",
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => assetInfo.names?.some((name) => name.endsWith(".css")) ? "app.css" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
