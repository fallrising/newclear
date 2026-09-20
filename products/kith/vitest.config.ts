import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/m1/**", "test/m2/**", "test/m3/**"],
  },
});
