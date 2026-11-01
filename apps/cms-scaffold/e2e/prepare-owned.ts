import { request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ADMIN, API, BACK, FRONT, seedPassword } from "./helpers.ts";

type Entry = { title: string; payload: Record<string, unknown> };
type ContextFactory = typeof request.newContext;

export function requireOwnedLocalProject(project: string | undefined): asserts project is string {
  if (!project || !/^cms-w5-e2e-\d+-[0-9a-f]{16}$/.test(project)) throw new Error("Member fixture setup requires the runner-owned disposable project marker");
  for (const origin of [API, BACK, FRONT, ADMIN]) {
    if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Disposable setup refuses a non-local API or app origin");
  }
}

async function login(context: APIRequestContext, username: string): Promise<string> {
  const response = await context.post(`${API}/api/v1/auth/login`, { data: { username, password: seedPassword(username) } });
  if (!response.ok()) throw new Error(`Disposable setup login failed (${response.status()})`);
  const body = await response.json() as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("Disposable setup login omitted CSRF token");
  return body.csrfToken;
}

/** W5 §0.2: API preparation exclusively for the runner's disposable project. */
export async function prepareOwnedMember(project: string | undefined, createContext: ContextFactory = (options) => request.newContext(options)): Promise<void> {
  requireOwnedLocalProject(project);
  const operator = await createContext({ extraHTTPHeaders: { Origin: BACK } });
  try {
    const csrf = await login(operator, "seed-operator-clinic");
    const response = await operator.get(`${API}/api/v1/content-types/pet/entries?size=100`);
    if (!response.ok()) throw new Error(`Disposable pet list failed (${response.status()})`);
    const body = await response.json() as { items: Entry[]; total: number };
    if (!Array.isArray(body.items) || body.total > body.items.length) throw new Error("Disposable pet list is incomplete");
    const leo = body.items.find((entry) => entry.title === "Leo");
    if (!leo || typeof leo.payload.owner !== "string" || typeof leo.payload.ownerPrincipalId !== "string") throw new Error("Leo's valid owner/principal binding is required for Mochi setup");
    const existing = body.items.find((entry) => entry.title === "Mochi");
    if (existing) {
      if (existing.payload.ownerPrincipalId !== leo.payload.ownerPrincipalId) throw new Error("Existing Mochi belongs to a different principal");
    } else {
      const created = await operator.post(`${API}/api/v1/content-types/pet/entries`, {
        headers: { "X-CSRF-Token": csrf },
        data: { slug: "w5-member-mochi", payload: { ...leo.payload, title: "Mochi", name: "Mochi", petType: "cat" } },
      });
      if (!created.ok()) throw new Error(`Disposable Mochi creation failed (${created.status()})`);
    }
  } finally { await operator.dispose(); }
  const member = await createContext({ extraHTTPHeaders: { Origin: FRONT } });
  try {
    await login(member, "seed-member-clinic");
    const response = await member.get(`${API}/api/v1/me/content-types/pet/entries?size=100`);
    if (!response.ok()) throw new Error(`Disposable member list failed (${response.status()})`);
    const body = await response.json() as { items: Entry[] };
    const titles = body.items.map((entry) => entry.title);
    if (!titles.includes("Leo") || !titles.includes("Mochi") || titles.includes("Basil")) throw new Error("Disposable member fixture ownership verification failed");
  } finally { await member.dispose(); }
}

/** W5 §0.5: publish only a newly created owned album, keeping seed entries intact. */
export async function prepareOwnedAudit(project: string | undefined, createContext: ContextFactory = (options) => request.newContext(options)): Promise<string> {
  requireOwnedLocalProject(project);
  const operator = await createContext({ extraHTTPHeaders: { Origin: BACK } });
  try {
    const csrf = await login(operator, "seed-operator-album");
    const listed = await operator.get(`${API}/api/v1/content-types/album/entries?size=100`);
    if (!listed.ok()) throw new Error(`Disposable album list failed (${listed.status()})`);
    const before = await listed.json() as { items: { id: string }[]; total: number };
    if (!Array.isArray(before.items) || !Number.isInteger(before.total) || before.total !== before.items.length) throw new Error("Disposable album list is incomplete");
    const existingIds = new Set(before.items.map((entry) => entry.id));
    const slug = `w5-audit-${project}-${randomUUID()}`;
    const title = `W5 owned audit ${slug}`;
    const created = await operator.post(`${API}/api/v1/content-types/album/entries`, {
      headers: { "X-CSRF-Token": csrf }, data: { slug, payload: { title, visibility: "unlisted" } },
    });
    if (!created.ok()) throw new Error(`Disposable album creation failed (${created.status()})`);
    const album = await created.json() as { id?: string; contentType?: string; slug?: string; title?: string; payload?: { title?: string; visibility?: string }; publicationState?: string };
    if (typeof album.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(album.id)
      || existingIds.has(album.id) || album.contentType !== "album" || album.slug !== slug || album.title !== title
      || album.payload?.title !== title || album.payload.visibility !== "unlisted" || album.publicationState !== "draft") {
      throw new Error("Disposable setup did not return a new owned album");
    }
    const published = await operator.post(`${API}/api/v1/entries/${album.id}/publish`, { headers: { "X-CSRF-Token": csrf } });
    if (!published.ok()) throw new Error(`Disposable album publication failed (${published.status()})`);
    const result = await published.json() as { id?: string; publicationState?: string };
    if (result.id !== album.id || result.publicationState !== "published") throw new Error("Disposable album publication response mismatched the owned album");
    return album.id;
  } finally { await operator.dispose(); }
}
