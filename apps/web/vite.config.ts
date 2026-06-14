import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // The workspace package is TypeScript source; let Vite transpile it directly.
    exclude: ["@meetup/core"],
  },
  server: {
    port: 5173,
    fs: {
      // Allow importing from the monorepo root (workspace packages).
      allow: ["../.."],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
