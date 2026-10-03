import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiOrigin = process.env.KITH_API_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: apiOrigin, changeOrigin: true, ws: true },
      "/mcp": { target: apiOrigin, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
