import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { PublicEntry } from "@cms/api/public";
import { createAppQueryClient } from "@cms/auth";
import { db, setSurface, setUser } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { routes } from "./routes";

/** Renders the real route table at `path` against the MSW mocks. Retries are off so errors show at once. */
export function renderRoute(path: string) {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
}

/** Collects every request the app sends through MSW (method, pathname, query string). */
export function recordRequests(): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname, search: url.search });
  });
  return requests;
}

/** The mock's public copy of an entry; tests change its payload, resetMocks() restores it. */
export function publicEntry(type: string, slug: string): PublicEntry {
  const entry = db.publicEntries.find((e) => e.contentType === type && e.slug === slug);
  if (!entry) throw new Error(`no public ${type} ${slug}`);
  return entry;
}

/** content of <meta name|property="key"> in <head>, or null. */
export function meta(key: string): string | null {
  return document.head.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.getAttribute("content") ?? null;
}

export function canonical(): string | null {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
}

/** V2-AC-15, U-01, U-05: words that must never be visible on a public page. */
export const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)", "publicationState", "Front office"] as const;

export function signInMember(username = "seed-member-clinic") { setSurface("front"); setUser(username); }
export function recordMemberPosts() {
  const posts: unknown[] = [];
  server.events.on("request:start", ({ request }) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/me/content-types/appointment_request/entries") {
      void request.clone().json().then((body: unknown) => posts.push(body));
    }
  });
  return posts;
}
