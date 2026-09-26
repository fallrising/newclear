/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // `--mode mock` serves the MSW worker script from @cms/mocks; production builds never contain it.
  publicDir: mode === "mock" ? "../../packages/mocks/public" : "public",
  server: { port: 5175, strictPort: true, host: true },
  preview: { port: 5175, strictPort: true, host: true },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
}));
