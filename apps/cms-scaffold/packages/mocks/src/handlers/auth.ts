import { http, HttpResponse } from "msw";
import type { CsrfToken, LoginResponse, Me } from "@cms/api";
import { me as seedUsers } from "../fixtures.gen";
import { currentUser } from "../guards";
import { apiError } from "../respond";
import { MOCK_CSRF_TOKEN, MOCK_WRONG_PASSWORD, setUser } from "../state";

export const authHandlers = [
  http.get("*/api/v1/auth/csrf", () => HttpResponse.json<CsrfToken>({ csrfToken: MOCK_CSRF_TOKEN })),

  http.post("*/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) return apiError(400, "VALIDATION_FAILED", "username and password are required");
    const user = seedUsers[username];
    if (!user || password === MOCK_WRONG_PASSWORD) return apiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    setUser(username);
    return HttpResponse.json<LoginResponse>({ ...user, csrfToken: MOCK_CSRF_TOKEN });
  }),

  http.post("*/api/v1/auth/logout", () => {
    if (!currentUser()) return apiError(401, "UNAUTHENTICATED", "Authentication required");
    setUser(null);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/v1/auth/me", () => {
    const user = currentUser();
    return user ? HttpResponse.json<Me>(user) : apiError(401, "UNAUTHENTICATED", "Authentication required");
  }),
];
