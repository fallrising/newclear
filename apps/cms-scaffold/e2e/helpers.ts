import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { redact as redactText } from "./redaction.mjs";

export const FRONT = process.env.CMS_E2E_FRONT || "http://localhost:5173";
export const BACK = process.env.CMS_E2E_BACK || "http://localhost:5174";
export const ADMIN = process.env.CMS_E2E_ADMIN || "http://localhost:5175";
export const API = process.env.CMS_E2E_API || "http://localhost:8080";

export function seedPassword(username: string): string {
  if (process.env.CMS_E2E_PASSWORD) return process.env.CMS_E2E_PASSWORD;
  const file = process.env.CMS_E2E_PASSWORD_FILE || "local/seed-passwords.txt";
  if (!existsSync(file)) throw new Error("Missing private seed password file or CMS_E2E_PASSWORD");
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((row) => row.startsWith(`${username}=`));
  if (!line || !line.slice(username.length + 1)) throw new Error(`No password for ${username} in private seed file`);
  return line.slice(username.length + 1);
}

export async function login(page: Page, origin: string, username: string): Promise<void> {
  // Each journey establishes its own identity, including multiple accounts within one journey.
  await page.context().clearCookies();
  await page.goto(`${origin}${origin === BACK ? "/sign-in" : "/login"}`);
  await page.getByLabel("帳號", { exact: true }).fill(username);
  await page.getByLabel("密碼", { exact: true }).fill(seedPassword(username));
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/auth/login" && r.request().method() === "POST");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  // Surface denial can be a successful login; the journey verifies its denial UI.
  expect((await response).status(), "seed login succeeds without logging request headers").toBe(200);
}

export async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name, exact: typeof name === "string" })).toBeVisible();
}

export async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(2_000, Math.max(1, deadline - Date.now()))) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* The stack may still be starting. */ }
    await new Promise((done) => setTimeout(done, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`HTTP readiness timed out after 60 seconds: ${url}`);
}

export function redact(text: string, secrets: readonly string[]): string {
  return redactText(text, secrets);
}
