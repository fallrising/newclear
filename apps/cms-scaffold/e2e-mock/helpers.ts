import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const FRONT = "http://localhost:5173";
export const BACK = "http://localhost:5174";
export const ADMIN = "http://localhost:5175";

/** V2-AC-14: zero critical or serious axe violations on the current page. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export async function computed(page: Page, selector: string, property: string) {
  return page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}
