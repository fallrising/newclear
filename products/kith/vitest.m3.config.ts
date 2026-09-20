import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve("migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ff_mcp: "on" },
        },
      }),
    ],
    test: {
      include: ["test/m3/mcp.test.ts", "test/m3/events.test.ts"],
      setupFiles: ["./test/m1/apply-migrations.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      isolate: false,
    },
  };
});
