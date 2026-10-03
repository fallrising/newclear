import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** products/kith/e2e */
export const E2E_DIR: string = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
/** products/kith */
export const KITH_DIR: string = join(E2E_DIR, "..");
/** products/kith/web */
export const WEB_DIR: string = join(KITH_DIR, "web");
/** products/kith/web/dist */
export const WEB_DIST_DIR: string = join(WEB_DIR, "dist");
/** products/kith/contracts/v2 */
export const CONTRACTS_DIR: string = join(KITH_DIR, "contracts", "v2");
/** products/kith/node_modules/.bin/wrangler */
export const WRANGLER_BIN: string = join(KITH_DIR, "node_modules", ".bin", "wrangler");
/** products/kith/e2e/node_modules/.bin/playwright */
export const PLAYWRIGHT_BIN: string = join(E2E_DIR, "node_modules", ".bin", "playwright");

export function artifactsRoot(): string {
  return process.env.KITH_E2E_ARTIFACTS_ROOT ?? join(E2E_DIR, "artifacts");
}
