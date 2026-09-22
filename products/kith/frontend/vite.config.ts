import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.KITH_DEV_HOST || "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // Local wrangler (`wrangler dev`) serves the Worker on 8787.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
      "/mcp": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
