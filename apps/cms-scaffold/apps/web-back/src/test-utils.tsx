import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { FieldsProvider } from "@cms/fields";
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
        <FieldsProvider value={{ work: api.work, url: (path) => api.url(path) }}>
          <RouterProvider router={router} />
          <Toaster />
        </FieldsProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

export interface RecordedRequest {
  method: string;
  path: string;
  /** Query string without "?", decoded, for example "state=draft&page=1". */
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
