import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the store runs on Vite (:5174) and proxies the public store API and images to
// wrangler dev (:8787, or NEXO_API). In production, Pages Functions do the same through a service binding.
const api = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.NEXO_API ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api/store": api,
      "/files": api,
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
