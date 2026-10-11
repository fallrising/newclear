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
            KITH_MAX_API_REQUESTS_PER_MINUTE: "1000",
            KITH_MAX_LOGIN_ATTEMPTS_PER_MINUTE: "1000",
            ff_hosted_agent: "on",
            KITH_PAID_ENABLED: "on",
            KITH_MAX_PAID_ATTEMPTS_PER_DAY: "1000",
            KITH_MAX_AGENT_ATTEMPTS_PER_DAY: "1000",
            KITH_MAX_PAID_CONCURRENCY: "8",
            FAKE_LLM_TEXT: "hello from grok",
            FAKE_LLM_MODELS: "grok-4.5",
          },
        },
      }),
    ],
    test: {
      include: ["test/m4/**/*.test.ts"],
      setupFiles: ["./test/m1/apply-migrations.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      isolate: false,
    },
  };
});
