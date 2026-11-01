import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the store runs on Vite (:5174) and proxies the public store API and images to
// wrangler dev (:8787). In production, Pages Functions do the same through a service binding.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api/store": "http://localhost:8787",
      "/files": "http://localhost:8787",
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
