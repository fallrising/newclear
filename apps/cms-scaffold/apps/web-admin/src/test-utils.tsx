import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { server } from "@cms/mocks/node";
import { api } from "./api";
import { routes } from "./routes";

/** Renders the real route table at `path` against the MSW mocks. Retries are off so errors show at once. */
export function renderRoute(path: string) {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider auth={api.auth}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { router };
}

export interface RecordedRequest {
  method: string;
  path: string;
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
    requests.push({ method: request.method, path: new URL(request.url).pathname, body });
  });
  return requests;
}
