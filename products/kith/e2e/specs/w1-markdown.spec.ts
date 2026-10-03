import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, sendViaComposer } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

const VECTORS = [
  "V1 <script>window.__xss=1</script>",
  'V2 <img src=x onerror="window.__xss=1">',
  "V3 [x](javascript:window.__xss=1)",
  "V4 [x](JAVASCRIPT:window.__xss=1)",
  "V5 [x](data:text/html;base64,PHNjcmlwdD4=)",
  "V6 ![img](https://example.com/a.png)",
  "V7 <javascript:window.__xss=1>",
  'V8 <iframe src="https://example.com"></iframe>',
  "V9 | a | b |\n| - | - |\n| 1 | 2 |",
  "V10 [ok](https://example.com) and https://example.com/auto and [m](mailto:a@example.com)",
  "V11 **b** *i* `c`\n- one\n- two\n> quote",
  "V12\n```ts\nconst a = 1;\n```",
];

test("E2E-W1-05 markdown whitelist renders safely", { tag: ["@W1"] }, async ({ page }, info) => {
  await page.addInitScript(() => {
    (window as unknown as { __xss: number }).__xss = 0;
  });
  await loginViaUi(page, ACCOUNTS.ada);
  await page.goto("/r/ada-private");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);

  const rowOf = (n: number) =>
    page.getByTestId("message-row").filter({ has: page.getByTestId("message-body").filter({ hasText: new RegExp(`^V${n}(?![0-9])`) }) });
  for (let i = 0; i < VECTORS.length; i++) {
    await sendViaComposer(page, VECTORS[i]!);
    await expect(rowOf(i + 1).last()).toBeVisible();
  }

  const body = (n: number) => rowOf(n).last().getByTestId("message-body");
  await expect(body(1)).toContainText("<script>window.__xss=1</script>");
  await expect(body(1).locator("script")).toHaveCount(0);
  await expect(body(2)).toContainText("<img src=x");
  await expect(body(2).locator("img")).toHaveCount(0);
  for (const n of [3, 4, 5]) {
    await expect(body(n)).toContainText("[x](");
    await expect(body(n).locator("a")).toHaveCount(0);
  }
  await expect(body(6).locator("img")).toHaveCount(0);
  await expect(body(6).locator('a[href="https://example.com/a.png"]')).toHaveCount(1);
  await expect(body(7)).toContainText("<javascript:window.__xss=1>");
  await expect(body(7).locator("a")).toHaveCount(0);
  await expect(body(8).locator("iframe")).toHaveCount(0);
  await expect(body(9).locator("table")).toHaveCount(0);
  const links = body(10).locator("a");
  await expect(links).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", "noopener noreferrer nofollow");
  }
  for (const sel of ["strong", "em", "code", "blockquote"]) await expect(body(11).locator(sel)).toHaveCount(1);
  await expect(body(11).locator("ul > li")).toHaveCount(2);
  await expect(body(12).getByTestId("md-code")).toHaveCount(1);
  await expect(body(12).getByTestId("md-code-lang")).toHaveText("ts");
  await expect(body(12).locator("pre")).toHaveText("const a = 1;");

  const tl = page.getByTestId("timeline");
  for (const sel of ["script", "img", "iframe", "table"]) await expect(tl.locator(sel)).toHaveCount(0);
  const hrefs = await tl.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  for (const h of hrefs) expect(h).toMatch(/^(https?:|mailto:)/);
  expect(await page.evaluate(() => (window as unknown as { __xss: number }).__xss)).toBe(0);
  note(info, "12 vectors rendered without executable content");
  await shot(page, info, "vectors");
});
