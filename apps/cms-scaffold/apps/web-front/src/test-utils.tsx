import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createAppQueryClient } from "@cms/auth";
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
  return { router };
}

/** Collects the pathname of every request the app sends through MSW. */
export function recordRequests(): string[] {
  const paths: string[] = [];
  server.events.on("request:start", ({ request }) => {
    paths.push(new URL(request.url).pathname);
  });
  return paths;
}
