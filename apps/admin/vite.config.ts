import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Two apps from one project: the business dashboard (index.html) and the platform administration
 * panel (admin/index.html, served at /admin/). In development every /admin/* route gets the admin page,
 * as the Worker does in production.
 */
const adminFallback = (): Plugin => ({
  name: "nexo-admin-fallback",
  configureServer(server) {
    server.middlewares.use((raw, _res, next) => {
      // Typed by hand: this project does not load Node's types.
      const req = raw as unknown as { url?: string; headers: Record<string, string | undefined> };
      const path = (req.url ?? "").split("?")[0]!;
      if ((path === "/admin" || path.startsWith("/admin/")) && !/\.[a-z0-9]+$/i.test(path) && req.headers.accept?.includes("text/html")) req.url = "/admin/index.html";
      next();
    });
  },
});

// In development the dashboard runs on Vite (:5173) and proxies the API to wrangler dev (:8787),
// so the browser sees a single origin, exactly as in production.
export default defineConfig({
  plugins: [react(), adminFallback()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/files": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Relative to the project root (apps/admin), on any OS.
    rollupOptions: { input: { main: "index.html", admin: "admin/index.html" } },
  },
});
