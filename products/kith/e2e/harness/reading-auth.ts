import type { Page, Browser, TestInfo } from "@playwright/test";
import { expect } from "../fixtures/kith.ts";
import { openActor } from "../fixtures/actors.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { fakeProviderLog } from "../fixtures/console.ts";
import { note } from "./evidence.ts";
import { query, request } from "./reading-db.ts";
import { ARTICLE_A } from "./reading-fixture.ts";
import { recordObservedSecret } from "./redact.ts";
import type { Recorder } from "./recorder.ts";

export async function checkExportBoundaries(page: Page, browser: Browser, recorder: Recorder, info: TestInfo): Promise<void> {
  // Caller already authenticated; re-login rotates cookies and races an existing app shell.
  const messages = query("SELECT * FROM messages ORDER BY id");
  const providers = (await fakeProviderLog()).length;
  const reading = await page.request.get("/api/reading");
  expect(reading.status()).toBe(200);
  const bundle = await reading.json() as { commit: string; articles: { body: string }[] };
  expect(bundle.commit).toMatch(/^[a-f0-9]{40}$/);
  const issued = await request(page.request, "POST", "/api/reading-export/tokens", {});
  expect(issued.status()).toBe(201);
  const credential = await issued.json() as { id: string; token: string };
  recordObservedSecret(credential.token);
  const bearer = { Authorization: `bEaReR ${credential.token}` };
  const anonymous = await browser.newContext({ baseURL: process.env.KITH_E2E_BASE_URL });
  const member = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "reading-member" });
  try {
    const before = query("SELECT * FROM notes ORDER BY id");
    for (const kind of ["captures", "notes"]) {
      const response = await anonymous.request.get(`/api/reading-export?kind=${kind}&limit=1`, { headers: bearer });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.text()).not.toMatch(/client_key|password|token_hash/);
    }
    const ack = await anonymous.request.post("/api/reading-export/ack", { headers: bearer, data: { commit: "a".repeat(40), captures: [], notes: [] } });
    expect(ack.status()).toBe(200);
    expect(await ack.json()).toEqual({ captures: 0, notes: 0 });
    // A valid operator cookie alongside a bearer token must not widen that token's scope.
    for (const client of [anonymous.request, page.request]) {
      for (const path of ["/api/reading", "/api/captures", `/api/notes/${ARTICLE_A}`, "/api/reading-export/tokens", "/api/rooms"]) {
        expect([401, 403]).toContain((await client.get(path, { headers: bearer })).status());
      }
      const profile = await client.patch("/api/me", { headers: bearer, data: { display_name: "denied" } });
      expect([401,403]).toContain(profile.status());
      const chat = await client.post("/api/rooms/synthetic-room/messages", { headers: bearer, data: { body: "denied chat" } });
      expect([401,403]).toContain(chat.status());
      const edit = await client.put(`/api/notes/${ARTICLE_A}`, { headers: bearer, data: { body: "denied", revision: 0 } });
      expect([401, 403]).toContain(edit.status());
      const issue = await client.post("/api/reading-export/tokens", { headers: bearer, data: {} });
      expect([401, 403]).toContain(issue.status());
    }
    for (const path of ["/_reading/current.json", "/_reading/current.json?download=1", "/%5freading/current.json", "/_reading%2fcurrent.json", "/_reading/../_reading/current.json"]) {
      for (const client of [anonymous.request, member.page.request, page.request]) {
        for (const method of ["GET", "HEAD"]) {
          const response = await client.fetch(path, { method });
          expect([401, 403, 404]).toContain(response.status());
          expect(response.headers()["cache-control"]).toContain("no-store");
          const text = await response.text();
          expect(text).not.toContain(bundle.commit);
          for (const article of bundle.articles) expect(text).not.toContain(article.body);
        }
      }
    }
    expect(query("SELECT * FROM notes ORDER BY id")).toEqual(before);
    const list = await request(page.request, "GET", "/api/reading-export/tokens");
    expect(await list.text()).not.toContain(credential.token);
    await page.goto("/reading");
    await page.locator("details").filter({ has: page.getByTestId("export-token-create") }).locator("summary").click();
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/reading-export/tokens" && response.request().method() === "POST");
    await page.getByTestId("export-token-create").click();
    const response = await created;
    expect(response.status()).toBe(201);
    const uiCredential = await response.json() as { id: string; token: string };
    recordObservedSecret(uiCredential.token);
    await expect(page.getByTestId("export-token-value")).toHaveText(uiCredential.token);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(storage).not.toContain(uiCredential.token);
    await page.getByTestId(`export-token-revoke-${uiCredential.id}`).click();
    await expect.poll(async () => (await anonymous.request.get("/api/reading-export?kind=captures", { headers: { Authorization: `Bearer ${uiCredential.token}` } })).status()).toBe(401);
    await page.getByTestId(`export-token-revoke-${credential.id}`).click();
    await expect.poll(async () => (await anonymous.request.get("/api/reading-export?kind=captures", { headers: bearer })).status()).toBe(401);
    expect((await anonymous.request.get("/api/reading-export?kind=captures", { headers: bearer })).status()).toBe(401);
    expect((await anonymous.request.post("/api/reading-export/ack", { headers: bearer, data: { commit: "a".repeat(40), captures: [], notes: [] } })).status()).toBe(401);
    expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messages);
    expect((await fakeProviderLog()).length).toBe(providers);
    note(info, "Real dedicated D1 credential allows only export/ACK, including when paired with operator cookie; immediate revocation, no secret listing, encoded/HEAD static paths denied, full chat rows/provider count unchanged.");
  } finally { await anonymous.close(); await member.context.close(); }
}
