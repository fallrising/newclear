// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PublicEntry } from "@cms/api/public";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** AC-09: `npm run typecheck` fails if PublicEntry ever gains these draft fields (the directives become unused). */
export function draftFieldsAreNotTyped(entry: PublicEntry) {
  // @ts-expect-error AC-09 PublicEntry has no publicationState
  void entry.publicationState;
  // @ts-expect-error AC-09 PublicEntry has no previewToken
  void entry.previewToken;
}

describe("Front isolation", () => {
  it("AC-08 web-front source imports @cms/api only through @cms/api/public", () => {
    const offenders = sources(SRC).filter((file) => /from "@cms\/api"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("AC-08 web-front source never names a work endpoint or a draft parameter", () => {
    const offenders = sources(SRC).filter((file) =>
      /\/api\/v1\/(entries|preview|principals|roles|admin)|publicationState|previewToken|includeDraft|read_draft/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("AC-09 PublicEntry has no draft fields (checked by typecheck)", () => {
    expect(draftFieldsAreNotTyped).toBeTypeOf("function");
  });

  it("AC-14 no second UI kit and no lightbox library; the lightbox is the @cms/ui Dialog", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((name) => /mui|chakra|antd|bootstrap|mantine|lightbox|carousel|masonry|swiper/i.test(name))).toEqual([]);
    expect(readFileSync(join(SRC, "lightbox.tsx"), "utf8")).toMatch(/import \{[^}]*\bDialog\b[^}]*\} from "@cms\/ui"/);
  });
});
