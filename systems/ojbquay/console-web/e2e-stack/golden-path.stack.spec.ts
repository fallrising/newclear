import {expect, test, type Page} from "@playwright/test";

// AC-10 against a running Compose stack (`KEEP_STACK=1 make e2e`); nothing is mocked.
const sink = process.env.OJBQUAY_PUSH_SINK_URL ?? "http://127.0.0.1:28081";
const password = process.env.OJBQUAY_ADMIN_PASSWORD ?? "local-admin-password";
const run = `${Date.now()}`;
const topic = `ui.orders.${run}`;
const delivered = `ui-delivered-${run}`;
const dead = `ui-dead-${run}`;

async function pick(page: Page, label: string, option: string) {
  await page.getByLabel(label).click();
  await page.getByLabel(label).fill(option);
  await page.locator(".ant-select-dropdown:visible").getByText(option, {exact: true}).click();
}

async function createGroup(page: Page, name: string) {
  await page.getByRole("menuitem").filter({hasText: "Consumer groups"}).click();
  await page.getByRole("button", {name: "Create group"}).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByRole("button", {name: "Create group"}).last().click();
  await expect(page.getByRole("cell", {name})).toBeVisible();
}

async function createSubscription(page: Page, group: string, endpoint: string, retries: string) {
  await page.getByRole("menuitem").filter({hasText: "Subscriptions"}).click();
  await page.getByRole("button", {name: "Create subscription"}).click();
  await pick(page, "Topic", topic);
  await pick(page, "Consumer group", group);
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByLabel("HTTP endpoints").fill(endpoint);
  await page.getByLabel("Retry intervals (ms)").fill(retries);
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByRole("button", {name: /Run preview$/}).click();
  await expect(page.getByText("DELIVER", {exact: true})).toBeVisible();
  await page
    .getByRole("dialog", {name: "Create subscription"})
    .getByRole("button", {name: /Create subscription$/})
    .click();
  await expect(page.getByRole("row").filter({hasText: group})).toBeVisible();
}

test("owner provisions, sends, inspects dead letters, replays, and signs out", async ({page, request}) => {
  test.setTimeout(180_000);

  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", {name: "Sign in"}).click();
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", {name: "Sign in"}).click();
  await expect(page.getByRole("heading", {name: "System overview"})).toBeVisible();
  await page.getByRole("menuitem").filter({hasText: "Topics"}).click();

  await page.getByRole("button", {name: "Create topic"}).click();
  await page.getByLabel("Topic name").fill(topic);
  await page.getByRole("button", {name: "Create topic"}).last().click();
  await expect(page.getByRole("cell", {name: topic})).toBeVisible();

  await createGroup(page, delivered);
  await createGroup(page, dead);
  await createSubscription(page, delivered, "http://push-sink:8080/events", "150");
  await createSubscription(page, dead, "http://push-sink:9/unreachable", "150");
  // Runtimes adopt new subscriptions within AC-01's five seconds.
  await page.waitForTimeout(5_000);

  const body = JSON.stringify({event: "console", run});
  await page.getByRole("menuitem").filter({hasText: "Topics"}).click();
  await expect(page.getByRole("heading", {name: "Topics"})).toBeVisible();
  await page.getByRole("cell", {name: topic}).click();
  await page.getByRole("tab", {name: "Sample & test"}).click();
  await page.getByRole("button", {name: "Send test message"}).click();
  await page.getByLabel("Message body").fill(body);
  await page.getByRole("button", {name: "Produce message"}).click();
  await expect(page.getByRole("dialog", {name: "Send test message"})).toBeHidden();
  await expect
    .poll(async () => (await request.get(`${sink}/last`)).text(), {timeout: 30_000})
    .toBe(body);
  await page.getByRole("button", {name: "Load sample"}).click();
  await expect(page.getByRole("heading", {name: /^p\d+ \/ 0 .*redacted/})).toBeVisible();
  await expect(page.getByText("Payload hidden")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("menuitem").filter({hasText: "Delay"}).click();
  await page.getByLabel("Delay ID").fill(`missing-${run}`);
  await page.getByRole("button", {name: "Inspect"}).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByRole("menuitem").filter({hasText: "Subscriptions"}).click();
  await page.getByRole("row").filter({hasText: dead}).getByRole("button", {name: "DLQ"}).click();
  const letters = page.getByRole("dialog", {name: "Dead letters"});
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("row").filter({hasText: dead}).getByRole("button", {name: "DLQ"}).click();
    await expect(letters.getByRole("row").nth(1).getByRole("checkbox")).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 60_000});
  const before = Number((await (await request.get(`${sink}/count`)).text()).trim());
  await letters.getByRole("row").nth(1).getByRole("checkbox").check();
  await letters.getByRole("button", {name: "Replay selected (1)"}).click();
  await expect(letters.getByRole("button", {name: "Replay selected (0)"})).toBeVisible();
  await expect
    .poll(async () => Number((await (await request.get(`${sink}/count`)).text()).trim()), {timeout: 30_000})
    .toBeGreaterThan(before);
  await letters.getByRole("button", {name: "Close"}).click();
  await expect(letters).toBeHidden();

  await page.getByRole("button", {name: "Logout"}).click();
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.goto("/subscriptions");
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
});
