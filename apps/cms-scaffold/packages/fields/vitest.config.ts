import { defineConfig } from "vitest/config";

// Datetime widgets show local time; tests fix the zone (01 §6.4: displayed in the user's zone, stored as UTC).
process.env.TZ = "Asia/Taipei";

export default defineConfig({
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
