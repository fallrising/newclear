// @vitest-environment node
import { resolve } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

async function modulesFor(symbol: string): Promise<string[]> {
  const entry = resolve(__dirname, "bundle-test-entry.ts");
  const result = await build({
    configFile: false, root: resolve(__dirname, ".."), logLevel: "silent",
    plugins: [{ name: "ui-import-fixture", resolveId: (id) => id === entry ? entry : undefined,
      load: (id) => id === entry ? `export { ${symbol} } from "@cms/ui";` : undefined }],
    build: { write: false, minify: false, lib: { entry, formats: ["es"] },
      rollupOptions: { external: (id) => /^react($|\/)|^react-dom($|\/)|^react-router$/.test(id) } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => "output" in output ? output.output.flatMap((chunk) => chunk.type === "chunk" ? Object.keys(chunk.modules) : []) : []);
}

describe("UI import boundaries", () => {
  it("a skeleton-only import excludes the unused toast implementation", async () => {
    const modules = await modulesFor("DefaultSkeleton");
    expect(modules.filter((id) => id.includes("/sonner/"))).toEqual([]);
    expect(modules.filter((id) => id.includes("/tailwind-merge/"))).toEqual([]);
  }, 30000);

  it("a live toast import retains Sonner and its initialization", async () => {
    expect((await modulesFor("toast")).some((id) => id.includes("/sonner/"))).toBe(true);
  }, 30000);
});
