import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import type {Page} from "../console-web/node_modules/@playwright/test";
import {login, origin, privateJSON} from "./browser-support.mjs";
import {negativeState} from "./negative-state.mjs";
import {secureContext} from "./browser-policy.mjs";
import {observeHealth} from "./health.mjs";
const require = createRequire(new URL("../console-web/package.json", import.meta.url));
const {test, expect} = require("@playwright/test");
const out = process.env.FE_REVIEW_OUTPUT!;
const sizes = [{name: "desktop", width: 1440, height: 900}, {name: "tablet", width: 834, height: 1112}, {name: "mobile", width: 390, height: 844}];

async function shot(page: Page, name: string, evidence: any) {
  const fixture = privateJSON("fixture.json");
  const file = `screenshots/${name}.png`;
  await page.screenshot({path: `${out}/${file}`, fullPage: true, mask: fixture.secrets.filter(Boolean).map((value: string) => page.getByText(value, {exact: true}))});
  const dimensions = await page.evaluate(() => ({viewport: innerWidth, documentWidth: document.documentElement.scrollWidth}));
  evidence.captures.push({name, file, sha256: createHash("sha256").update(readFileSync(`${out}/${file}`)).digest("hex"), ...dimensions});
}
async function pick(page: Page, label: string, option: string) {
  await page.getByLabel(label, {exact: true}).click();
  await page.getByLabel(label, {exact: true}).fill(option);
  await page.locator(".ant-select-dropdown:visible").getByText(option, {exact: true}).click();
}
async function go(page: Page, route: string, heading: string) {
  const response = await page.goto(origin + route);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", {name: heading, exact: true})).toBeVisible();
  expect(page.url()).toBe(origin + route);
}
async function close(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function wrongPassword(page: Page, credentials: any, size: string, evidence: any) {
  await page.getByLabel("Username", {exact: true}).fill(credentials.user);
  await page.getByLabel("Password", {exact: true}).fill("synthetic-wrong-password");
  const responsePromise = page.waitForResponse(response => response.url() === origin + "/api/v1/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  const response = await responsePromise;
  expect(response.status()).toBe(401);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Username", {exact: true}).fill("");
  await page.getByLabel("Password", {exact: true}).fill("");
  const negative = negativeState(size, response.status());
  evidence.badPassword = negative.evidence;
  await shot(page, negative.captureName, evidence);
}

const negativeOnly = process.env.FE_REVIEW_MOBILE_NEGATIVE_ONLY === '1';
for (const size of sizes.filter(size => !negativeOnly || size.name === 'mobile')) test(`real states ${size.name}`, async ({page}: {page: Page}) => {
  if (!/^\/evidence\/[a-z0-9-]+$/.test(out)) throw new Error("REVIEW_OUTPUT");
  await secureContext(page.context());
  const credentials = privateJSON("browser.json");
  const fixture = privateJSON("fixture.json");
  const evidence: any = {viewport: size.name, passed: false, captures: [], health: [], pageErrors: 0, phase: "login"};
  const observers = [observeHealth(page, () => evidence.phase)];
  const health = () => observers.flatMap(observe => observe());
  try {
    await page.setViewportSize({width: size.width, height: size.height});
    if (negativeOnly) {
      evidence.phase = "bad-password";
      await go(page, "/login", "Welcome back");
      await wrongPassword(page, credentials, size.name, evidence);
      evidence.health = health();
      expect(evidence.health.filter((item: any) => item.classification === "unexpected")).toHaveLength(0);
      evidence.passed = true;
      return;
    }
    await login(page, credentials);
    evidence.phase = "topic";
    await go(page, "/topics", "Topics");
    await page.getByRole("cell", {name: fixture.topic.name, exact: true}).click();
    await expect(page.getByRole("tab", {name: "Configuration", exact: true})).toBeVisible();
    await shot(page, `${size.name}-topic-configuration`, evidence);
    await page.getByRole("tab", {name: "Sample & test", exact: true}).click();
    await expect(page.getByRole("button", {name: /Load sample$/})).toBeVisible();
    await shot(page, `${size.name}-topic-sample`, evidence);
    await close(page);
    evidence.phase = "group";
    await go(page, "/groups", "Consumer groups");
    await page.getByRole("cell", {name: fixture.groups[0].name, exact: true}).click();
    await expect(page.getByRole("heading", {name: "Partition progress", exact: true})).toBeVisible();
    await shot(page, `${size.name}-group`, evidence);
    await close(page);
    evidence.phase = "dlq";
    await go(page, "/subscriptions", "Subscriptions");
    await page.getByRole("row").filter({hasText: fixture.groups[1].name}).getByRole("button", {name: /DLQ$/}).click();
    await expect(page.getByRole("dialog", {name: "Dead letters", exact: true}).getByRole("checkbox").nth(1)).toBeVisible();
    await shot(page, `${size.name}-dlq`, evidence);
    await close(page);
    evidence.phase = "wizard";
    await page.getByRole("button", {name: /Create subscription$/}).click();
    await pick(page, "Topic", fixture.topic.name);
    await pick(page, "Consumer group", fixture.groups[0].name);
    await shot(page, `${size.name}-wizard-step1`, evidence);
    await page.getByRole("button", {name: "Continue", exact: true}).click();
    await page.getByLabel("HTTP endpoints", {exact: true}).fill("http://push-sink:8080/events");
    await page.getByLabel("Retry intervals (ms)", {exact: true}).fill("150, 300");
    await shot(page, `${size.name}-wizard-step2`, evidence);
    await page.getByRole("button", {name: "Continue", exact: true}).click();
    await shot(page, `${size.name}-wizard-step3`, evidence);
    await page.getByRole("button", {name: "Continue", exact: true}).click();
    await shot(page, `${size.name}-wizard-step4`, evidence);
    await page.getByRole("button", {name: /Run preview$/}).click();
    await expect(page.getByText("DELIVER", {exact: true})).toBeVisible();
    await shot(page, `${size.name}-wizard-preview`, evidence);
    await close(page);
    evidence.phase = "delay-present";
    await go(page, "/delay", "Delay inspector");
    await page.getByLabel("Delay ID", {exact: true}).fill(fixture.delayId);
    await page.getByRole("button", {name: /Inspect$/}).click();
    await expect(page.getByText(fixture.delayId, {exact: true})).toBeVisible();
    await shot(page, `${size.name}-delay-present`, evidence);
    evidence.phase = "missing-delay";
    await page.getByLabel("Delay ID", {exact: true}).fill("missing-review-id");
    await page.getByRole("button", {name: /Inspect$/}).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await shot(page, `${size.name}-missing-delay`, evidence);
    evidence.phase = "empty-supplement";
    await page.route("**/api/v1/topics", (route: any) => route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({code: "OK", msg: "", data: []})}));
    await go(page, "/topics", "Topics");
    await expect(page.getByText("Nothing here yet", {exact: true})).toBeVisible();
    await shot(page, `${size.name}-controlled-empty`, evidence);
    await page.unroute("**/api/v1/topics");
    evidence.phase = "error-supplement";
    await page.route("**/api/v1/topics", (route: any) => route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({code: "REVIEW_FAILURE", msg: "Synthetic review failure", data: null})}));
    await go(page, "/topics", "Topics");
    await expect(page.getByText("Unable to load this view", {exact: true})).toBeVisible();
    await shot(page, `${size.name}-controlled-500`, evidence);
    await page.unroute("**/api/v1/topics");
    evidence.phase = "bad-password";
    if (size.name === "mobile") {
      const anonymous = await page.context().browser()!.newContext({viewport: {width: size.width, height: size.height}, locale: "en-US", colorScheme: "light", serviceWorkers: "block"});
      try {
        await secureContext(anonymous);
        const negativePage = await anonymous.newPage();
        observers.push(observeHealth(negativePage, () => evidence.phase));
        await go(negativePage, "/login", "Welcome back");
        await wrongPassword(negativePage, credentials, size.name, evidence);
      } finally {await anonymous.close();}
    } else {
      await page.getByRole("button", {name: /Logout$/}).click();
      await expect(page.getByRole("heading", {name: "Welcome back", exact: true})).toBeVisible();
      await wrongPassword(page, credentials, size.name, evidence);
    }
    evidence.health = health();
    expect(evidence.health.filter((item: any) => item.classification === "unexpected")).toHaveLength(0);
    evidence.passed = true;
  } finally {
    evidence.health = health();
    evidence.pageErrors = evidence.health.filter((item: any) => item.kind === "pageerror").length;
    if (!evidence.passed) evidence.failurePhase = evidence.phase;
    delete evidence.phase;
    const text = JSON.stringify(evidence, null, 2);
    for (const secret of [credentials.password, ...fixture.secrets]) if (secret && text.includes(secret)) throw new Error("REVIEW_PUBLIC_SECRET");
    writeFileSync(`${out}/${size.name}-states.json`, text, {flag: "wx", mode: 0o600});
  }
});
