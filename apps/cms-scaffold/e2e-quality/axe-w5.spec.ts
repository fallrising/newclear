import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pages, states } from "./pages";
import { openCase, prepares, settle } from "./helpers";

type AxeRow = { id: string; url: string; viewport: { width: number; height: number } | null; critical: number; serious: number; violations: { id: string; impact: string | null | undefined; targets: unknown[] }[] };
const rows: AxeRow[] = [];
async function scan(page: Page, id: string): Promise<AxeRow> {
  const result = await new AxeBuilder({ page }).analyze();
  return { id, url: page.url(), viewport: page.viewportSize(), critical: result.violations.filter(v => v.impact === "critical").length, serious: result.violations.filter(v => v.impact === "serious").length,
    violations: result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })) };
}
async function writeAxe(values: AxeRow[]): Promise<void> {
  mkdirSync("test-results/frontend", { recursive: true });
  writeFileSync("test-results/frontend/axe.json", JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(), gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), expected: 60, result: values.length === 60 && values.every(v => v.critical === 0 && v.serious === 0) ? "passed" : "failed", rows: values }, null, 2));
}
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const probe = await context.newPage();
  try {
    await probe.setContent("<button></button>");
    const row = await scan(probe, "negative-control-unlabeled-button");
    expect(row.critical + row.serious).toBeGreaterThan(0);
    expect(row.violations.some(v => v.id === "button-name")).toBe(true);
    mkdirSync("test-results/frontend", { recursive: true });
    writeFileSync("test-results/frontend/axe-negative-control.json", JSON.stringify(row, null, 2));
  } finally { await context.close(); }
});
test.afterEach(async () => { await writeAxe(rows); });
for (const c of pages) test(`V2-AC-14 axe ${c.id}`, async ({ page }) => {
  await openCase(page, c, "desktop");
  const row = await scan(page, c.id); rows.push(row);
  expect(row.critical + row.serious, JSON.stringify(row.violations)).toBe(0);
});
for (const state of states) test(`V2-AC-14 axe ${state.id}`, async ({ page }) => {
  await openCase(page, pages.find(c => c.id === state.pageId)!, "desktop");
  await prepares[state.prepare](page); await settle(page);
  const row = await scan(page, state.id); rows.push(row);
  expect(row.critical + row.serious, JSON.stringify(row.violations)).toBe(0);
});
