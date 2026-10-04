import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { Toaster } from "@cms/ui";
import { server } from "@cms/mocks/node";
import { api } from "./api";
import { routes } from "./routes";

/** Renders the real route table at `path` against the MSW mocks, with the same providers as App. Retries are off so errors show at once. */
export function renderRoute(path: string) {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider auth={api.auth}>
        <RouterProvider router={router} />
        <Toaster />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

export interface RecordedRequest {
  method: string;
  path: string;
  /** Query string without "?", decoded, for example "page=1&size=20". */
  search: string;
  body: unknown;
}

/** Collects every request the app sends through MSW (JSON bodies parsed). */
export function recordRequests(): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  server.events.on("request:start", async ({ request }) => {
    const text = request.method === "GET" ? "" : await request.clone().text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname, search: decodeURIComponent(url.search.slice(1)), body });
  });
  return requests;
}

/** The writes (non-GET, CSRF excluded) among recorded requests. */
export function writes(requests: RecordedRequest[]) {
  return requests.filter((r) => r.method !== "GET");
}

/** Opens PageHeader's 更多動作 menu (Radix opens it on Enter in jsdom). */
export async function openMoreActions() {
  fireEvent.keyDown(await screen.findByTestId("page-more-actions"), { key: "Enter" });
}

/** V2-AC-15: engineering words that must never be visible. */
export const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)"] as const;

/** Seed ids used across the tests (docs/v2/contracts/fixtures). */
export const IDS = {
  admin: "10000000-0000-4000-8000-000000000001",
  editorAlbum: "10000000-0000-4000-8000-000000000002",
  operatorAlbum: "10000000-0000-4000-8000-000000000003",
  memberClinic: "10000000-0000-4000-8000-000000000004",
  coast: "30000000-0000-4000-8000-000000000001",
  harbour: "30000000-0000-4000-8000-000000000002",
  betty: "30000000-0000-4000-8000-000000000017",
  lens: "30000000-0000-4000-8000-000000000036",
  studio: "30000000-0000-4000-8000-000000000008",
  auditPublishCoast: "70000000-0000-4000-8000-000000000003",
  auditRetention: "70000000-0000-4000-8000-000000000007",
  auditLogin: "70000000-0000-4000-8000-000000000009",
} as const;
