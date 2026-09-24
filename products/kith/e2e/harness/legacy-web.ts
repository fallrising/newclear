import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KITH_DIR } from "./paths.ts";

// Serves the v1 frontend/ through vite preview, proxied to the E2E wrangler (E2E-W1-01).

export type LegacyWeb = { url: string; close(): Promise<void> };

type VitePreviewServer = { resolvedUrls: { local: string[] } | null; close(): Promise<void> };
type ViteModule = { preview(config: object): Promise<VitePreviewServer> };

export async function startLegacyWeb(apiOrigin: string): Promise<LegacyWeb> {
  const FRONTEND_DIR = join(KITH_DIR, "frontend");
  const viteEntry = join(FRONTEND_DIR, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(viteEntry)) throw new Error("run npm ci in products/kith/frontend");
  if (!existsSync(join(FRONTEND_DIR, "dist", "index.html"))) {
    const b = spawnSync("npm", ["run", "build"], { cwd: FRONTEND_DIR, encoding: "utf8" });
    if (b.status !== 0) throw new Error("legacy frontend build failed");
  }
  const vite = (await import(pathToFileURL(viteEntry).href)) as ViteModule;
  const server = await vite.preview({
    configFile: false,
    root: FRONTEND_DIR,
    logLevel: "silent",
    preview: {
      host: "127.0.0.1",
      port: 0,
      proxy: {
        "/api": { target: apiOrigin, changeOrigin: true, ws: true },
        "/mcp": { target: apiOrigin, changeOrigin: true },
      },
    },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("legacy preview did not report a URL");
  return { url: url.replace(/\/$/, ""), close: () => server.close() };
}
