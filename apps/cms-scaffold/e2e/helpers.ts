import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

export const FRONT = process.env.CMS_E2E_FRONT || "http://localhost:5173";
export const BACK = process.env.CMS_E2E_BACK || "http://localhost:5174";
export const ADMIN = process.env.CMS_E2E_ADMIN || "http://localhost:5175";
export const API = process.env.CMS_E2E_API || "http://localhost:8080";

export function seedPassword(username: string): string {
  const shared = process.env.CMS_E2E_PASSWORD || process.env.CMS_SEED_PASSWORD;
  if (shared) return shared;
  const file = process.env.CMS_E2E_PASSWORD_FILE || "local/seed-passwords.txt";
  if (!existsSync(file)) {
    throw new Error(
      `Missing ${file}. Copy it from the API container or set CMS_E2E_PASSWORD. Example: docker cp cms-scaffold-cms-api-1:/app/local/seed-passwords.txt local/seed-passwords.txt`,
    );
  }
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((row) => row.startsWith(`${username}=`));
  if (!line) {
    throw new Error(`No password for ${username} in ${file}`);
  }
  return line.slice(username.length + 1);
}

export async function login(page: Page, origin: string, username: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("帳號").fill(username);
  await page.locator('input[type="password"]').fill(seedPassword(username));
  await page.getByRole("button", { name: "登入" }).click();
}

export async function expectHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole("heading", { name })).toBeVisible();
}
