import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx", "**/test-setup.ts", "**/test-utils.tsx"];
const NO_MOCKS = { group: ["@cms/mocks", "@cms/mocks/*"], message: "Mocks load only through the MODE === \"mock\" dynamic import in main.tsx and in tests." };
const PUBLIC_API_ONLY = { name: "@cms/api", message: "Import @cms/api/public: web-front and @cms/auth must not reach work or admin endpoints (surface-front AC-08)." };

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/build/**", "**/public/mockServiceWorker.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web-front/src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-imports": ["error", { paths: [PUBLIC_API_ONLY], patterns: [NO_MOCKS] }] },
  },
  {
    files: ["apps/web-back/src/**/*.{ts,tsx}", "apps/web-admin/src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [NO_MOCKS] }] },
  },
  {
    files: ["packages/auth/src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-imports": ["error", { paths: [PUBLIC_API_ONLY], patterns: [NO_MOCKS] }] },
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@cms/*"], message: "@cms/ui depends on no other @cms package (01 §4.1)." }] }] },
  },
);
