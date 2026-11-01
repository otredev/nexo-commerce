import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the dashboard runs on Vite (:5173) and proxies the API to wrangler dev (:8787),
// so the browser sees a single origin, exactly as in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/files": "http://localhost:8787",
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
