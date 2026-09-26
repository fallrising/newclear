import { delay, http } from "msw";
import { csrfFailure } from "../guards";
import { apiError } from "../respond";
import { getState, SLOW_DELAY_MS } from "../state";

/** Runs first for every API call: scenario delay, scenario 500, CSRF. Falls through when nothing applies. */
export const commonHandlers = [
  http.all("*/api/v1/*", async ({ request }) => {
    const { scenario } = getState();
    if (scenario === "slow") await delay(SLOW_DELAY_MS);
    const path = new URL(request.url).pathname;
    if (scenario === "error500" && !path.startsWith("/api/v1/auth/")) {
      return apiError(500, "INTERNAL_ERROR", "Internal error");
    }
    return csrfFailure(request) ?? undefined;
  }),
];

/** Registered last: anything else under /api/v1 is an unknown route. */
export const fallbackHandlers = [
  http.all("*/api/v1/*", () => apiError(404, "ROUTE_NOT_FOUND", "No such route")),
];

/** `q` (case-insensitive title contains) and `ref.<field>=<id>` filters shared by list handlers. */
export function matchesList(url: URL, entry: { title: string | null; payload: Record<string, unknown> }) {
  const q = url.searchParams.get("q");
  if (q && !(entry.title ?? "").toLowerCase().includes(q.toLowerCase())) return false;
  for (const [name, value] of url.searchParams) {
    if (!name.startsWith("ref.") || value === "") continue;
    const raw = entry.payload[name.slice(4)];
    const id = raw && typeof raw === "object" && "id" in raw ? (raw as { id: unknown }).id : raw;
    if (id !== value) return false;
  }
  return true;
}
