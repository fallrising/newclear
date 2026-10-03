import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { describe, expect, it } from "vitest";

const spec = new URL("../../../services/cms-api/src/main/resources/openapi/openapi.yaml", import.meta.url);
const generated = new URL("./generated/schema.d.ts", import.meta.url);

describe("OpenAPI codegen", () => {
  it("E-02 src/generated/schema.d.ts is up to date with openapi.yaml (run `npm run gen -w @cms/api`)", async () => {
    const ast = await openapiTS(spec);
    const fresh = astToString(ast);
    const committed = readFileSync(fileURLToPath(generated), "utf8");
    expect(committed.endsWith(fresh)).toBe(true);
  });
});
