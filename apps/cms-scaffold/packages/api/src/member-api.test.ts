import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError, createAppointment, createFrontClient, keys, memberQueries, type AppointmentDraft, type MemberEntry } from "./public-entry";
import { keys as baseKeys } from "./keys";

const API = "http://api.test";
const draft: AppointmentDraft = { pet: "42000000-0000-4000-8000-000000000001", preferredAt: "2026-10-20T01:30:00.000Z", reason: "皮膚搔癢" };
const entry: MemberEntry = { id: "43000000-0000-4000-8000-000000000001", contentType: "appointment_request", publicationState: "draft", title: draft.reason, payload: { ...draft }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
const page = { items: [entry], total: 1, page: 1, size: 100, offset: 0, limit: 100 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function stub(responder: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    requests.push(request.clone());
    return responder(request);
  });
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe("W3b member API contract", () => {
  it("G08_memberListUsesGenericBw5PathAndStableKey", async () => {
    const requests = stub(() => json(200, page));
    const api = createFrontClient({ baseUrl: API });
    const query = memberQueries.list(api, "pet", { size: 100 });
    expect(query.queryKey).toEqual(["member", "entries", "pet", { size: 100 }]);
    expect(keys.member.list("appointment_request", { size: 100 })).toEqual(["member", "entries", "appointment_request", { size: 100 }]);
    await expect(new QueryClient().fetchQuery(query)).resolves.toEqual(page);
    expect(requests[0].url).toBe(`${API}/api/v1/me/content-types/pet/entries?size=100`);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].credentials).toBe("include");
    for (const name of Object.keys(baseKeys) as (keyof typeof baseKeys)[]) expect(keys[name]).toBe(baseKeys[name]);
  });

  it("G08_memberDetailUsesMeEntryPath", async () => {
    const requests = stub(() => json(200, entry));
    const query = memberQueries.detail(createFrontClient({ baseUrl: API }), entry.id);
    expect(query.queryKey).toEqual(["member", "entry", entry.id]);
    const result: MemberEntry = await new QueryClient().fetchQuery(query);
    expect(result).toEqual(entry);
    expect(requests[0].url).toBe(`${API}/api/v1/me/entries/${entry.id}`);
  });

  it("AC12_createAppointmentSendsOnlyAllowedPayload", async () => {
    const requests = stub((request) => request.url.endsWith("/auth/csrf") ? json(200, { csrfToken: "member-token" }) : json(201, entry));
    const extra = { ...draft, ownerPrincipalId: "forbidden", publicationState: "published", version: 99, publish: true };
    await expect(createAppointment(createFrontClient({ baseUrl: API }), extra)).resolves.toEqual(entry);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /api/v1/auth/csrf", "POST /api/v1/me/content-types/appointment_request/entries",
    ]);
    expect(await requests[1].json()).toEqual({ payload: draft });
    expect(requests[1].headers.get("X-CSRF-Token")).toBe("member-token");
  });

  it.each([[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [404, "ENTRY_NOT_FOUND"], [422, "REF_TARGET_NOT_FOUND"], [429, "RATE_LIMITED"], [500, "INTERNAL_ERROR"]] as const)("G08_memberErrorsAreApiErrors %s %s", async (status, code) => {
    const fields = [{ field: "payload.pet", code: "REF_TARGET_NOT_FOUND", message: "Developer detail" }];
    stub(() => json(status, { error: { code, message: "Developer detail", fields }, requestId: "member-error" }));
    const error = await createFrontClient({ baseUrl: API }).member.detail(entry.id).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, fields, requestId: "member-error" });
  });
});
