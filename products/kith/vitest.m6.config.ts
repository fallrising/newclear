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
          bindings: {
            TEST_MIGRATIONS: migrations,
            ff_hosted_agent: "on",
            ff_ambient: "on",
            FAKE_LLM_TEXT: "hello from grok",
            FAKE_LLM_MODELS: "grok-4.5",
          },
        },
      }),
    ],
    test: {
      include: ["test/m6/**/*.test.ts"],
      setupFiles: ["./test/m1/apply-migrations.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      isolate: false,
    },
  };
});
