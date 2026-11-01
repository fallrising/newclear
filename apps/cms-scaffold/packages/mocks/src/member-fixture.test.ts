import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { components } from "@cms/api";
import { fixtures, MOCK_CSRF_TOKEN, setScenario, setSurface, setUser } from "./index";
import { resetMocks, server } from "./node";

type MemberEntry = components["schemas"]["MemberEntry"];
const sourceUrl = new URL("../../../docs/v2/contracts/fixtures/member-entries.json", import.meta.url);
const contract = JSON.parse(readFileSync(sourceUrl, "utf8"));
const API = "http://localhost:8080";
const raw = (path: string, init?: RequestInit) => fetch(`${API}/api/v1/me${path}`, init);
const post = (body: unknown, type = "appointment_request") => raw(`/content-types/${type}/entries`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": MOCK_CSRF_TOKEN }, body: JSON.stringify(body) });
const list = async (type: string) => (await raw(`/content-types/${type}/entries?size=100`)).json();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => { resetMocks(); setSurface("front"); setUser("seed-member-clinic"); });

describe("W3b deterministic member fixture and handlers", () => {
  it("G08_fixtureIsDeterministicAndMatchesDocsContract", () => {
    expect(readFileSync(new URL("../fixtures/member-entries.json", import.meta.url))).toEqual(readFileSync(sourceUrl));
    expect(fixtures.memberEntries).toEqual(contract);
    expect(contract.clock).toBe("2026-10-01T00:00:00Z");
    expect(contract.members).toHaveLength(2);
    const entries: MemberEntry[] = contract.members.flatMap((member: { pets: MemberEntry[]; appointmentRequests: MemberEntry[] }) => [...member.pets, ...member.appointmentRequests]);
    expect(contract.members.flatMap((member: { pets: MemberEntry[] }) => member.pets)).toHaveLength(3);
    expect(contract.members.flatMap((member: { appointmentRequests: MemberEntry[] }) => member.appointmentRequests)).toHaveLength(3);
    const ids = [...entries.map((entry) => entry.id), contract.createCases.valid.response.id];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const me = JSON.parse(readFileSync(new URL("../../../docs/v2/contracts/fixtures/me.json", import.meta.url), "utf8"));
    for (const member of contract.members) {
      expect(member.principal).toEqual(me[member.principal.username].principal);
      for (const entry of [...member.pets, ...member.appointmentRequests]) expect(entry.payload.ownerPrincipalId).toBe(member.principal.id);
    }
    const forbidden = contract.crossOwnerForbidden;
    expect(contract.members.find((member: { principal: { username: string } }) => member.principal.username === forbidden.targetOwnerUsername).appointmentRequests.some((entry: MemberEntry) => entry.id === forbidden.targetEntryId)).toBe(true);
  });

  it("AC10_memberListsContainOnlyCurrentOwnersEntries", async () => {
    for (const member of contract.members) {
      setUser(member.principal.username);
      expect(await list("pet")).toEqual({ items: member.pets, total: member.pets.length, page: 1, size: 100, offset: 0, limit: 100 });
      expect(await list("appointment_request")).toEqual({ items: member.appointmentRequests, total: member.appointmentRequests.length, page: 1, size: 100, offset: 0, limit: 100 });
    }
  });

  it("AC11_crossOwnerFixtureReturnsForbiddenWithoutPayload", async () => {
    const forbidden = contract.crossOwnerForbidden;
    setUser(forbidden.actorUsername);
    const response = await raw(`/entries/${forbidden.targetEntryId}`);
    expect(response.status).toBe(forbidden.expectedStatus);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: forbidden.expectedErrorCode } });
    for (const secret of forbidden.mustNotContain) expect(body).not.toContain(secret);
  });

  it("AC12_validCreateUsesFixedResponseAndForeignPetFails", async () => {
    const { valid, foreignPet } = contract.createCases;
    const response = await post({ payload: { ...valid.request.payload, preferredAt: "2026-10-20T01:30:00.000Z" } });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(valid.response);
    expect((await list("appointment_request")).items.at(-1)).toEqual(valid.response);
    const rejected = await post(foreignPet.request);
    expect(rejected.status).toBe(foreignPet.expectedStatus);
    expect(await rejected.json()).toMatchObject({ error: { code: foreignPet.expectedErrorCode, fields: [{ field: foreignPet.expectedField }] } });
  });

  it("G08_resetRestoresMemberFixture", async () => {
    await post(contract.createCases.valid.request);
    resetMocks(); setSurface("front"); setUser("seed-member-clinic");
    expect((await list("appointment_request")).items).toEqual(contract.members[0].appointmentRequests);
    const first = await post(contract.createCases.valid.request);
    expect(await first.json()).toEqual(contract.createCases.valid.response);
  });

  it("G08_memberRequiresSessionAndFrontSurface", async () => {
    for (const action of [() => raw("/content-types/pet/entries"), () => raw(`/entries/${contract.crossOwnerForbidden.targetEntryId}`), () => post(contract.createCases.valid.request)]) {
      setUser(null);
      const anonymous = await action();
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      setUser("seed-member-clinic"); setSurface("back");
      const back = await action();
      expect(back.status).toBe(403);
      expect(await back.json()).toMatchObject({ error: { code: "SURFACE_FORBIDDEN" } });
      setSurface("front");
    }
  });

  it("G08_unknownMemberIsEmptyAndCannotCreateForFixtureOwner", async () => {
    setUser("seed-operator-album");
    expect(await list("pet")).toMatchObject({ items: [], total: 0 });
    const result = await post(contract.createCases.valid.request);
    expect(result.status).toBe(422);
    expect(JSON.stringify(await result.json())).not.toContain(contract.createCases.valid.response.payload.ownerPrincipalId);
    setUser("seed-member-projects");
    const foreign = await post(contract.createCases.valid.request);
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toMatchObject({ error: { code: "REF_TARGET_NOT_FOUND" } });
    const owned = await post({ payload: { ...contract.createCases.valid.request.payload, pet: contract.members[1].pets[0].id } });
    expect(owned.status).toBe(422);
    expect(JSON.stringify(await owned.json())).not.toContain(contract.createCases.valid.response.payload.ownerPrincipalId);
  });

  it.each(["state=draft", "size=0", "size=101", "size=1.5", "size=x", "page=0", "page=1.1", "page=x"])("G08_memberListRejectsInvalidQuery %s", async (query) => {
    expect((await raw(`/content-types/pet/entries?${query}`)).status).toBe(400);
  });

  it("G08_memberListPaginationPreservesFixtureOrder", async () => {
    expect(await (await raw("/content-types/pet/entries?page=2&size=1&sort=title,desc")).json()).toEqual({ items: [contract.members[0].pets[1]], total: 2, page: 2, size: 1, offset: 1, limit: 1 });
  });

  it("G08_missingMemberTypeAndEntryReturnContractNotFound", async () => {
    expect(await (await raw("/content-types/unknown/entries")).json()).toMatchObject({ error: { code: "CONTENT_TYPE_NOT_FOUND" } });
    expect(await (await raw("/entries/43000000-0000-4000-8000-999999999999")).json()).toMatchObject({ error: { code: "ENTRY_NOT_FOUND" } });
    expect(await (await post(contract.createCases.valid.request, "pet")).json()).toMatchObject({ error: { code: "CONTENT_TYPE_NOT_FOUND" } });
    expect(await (await raw(`/entries/${contract.members[0].appointmentRequests[0].id}`)).json()).toEqual(contract.members[0].appointmentRequests[0]);
  });

  it("G08_memberRejectsForbiddenBodyFieldsAndMalformedJson", async () => {
    for (const key of ["ownerPrincipalId", "publicationState", "version", "publish"]) {
      expect((await post({ ...contract.createCases.valid.request, [key]: null })).status).toBe(400);
      expect((await post({ payload: { ...contract.createCases.valid.request.payload, [key]: null } })).status).toBe(400);
    }
    const malformed = await raw("/content-types/appointment_request/entries", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": MOCK_CSRF_TOKEN }, body: "{" });
    expect(malformed.status).toBe(400);
    const fields = await post({ payload: { pet: "", preferredAt: "invalid", reason: " " } });
    expect(fields.status).toBe(422);
    expect(await fields.json()).toMatchObject({ error: { code: "FIELD_VALIDATION", fields: expect.arrayContaining([expect.objectContaining({ field: "payload.pet" }), expect.objectContaining({ field: "payload.preferredAt" }), expect.objectContaining({ field: "payload.reason" })]) } });
  });

  it("G08_memberScenariosAreDeterministicAndIndependent", async () => {
    for (const scenario of ["empty", "memberPetsEmpty", "memberAppointmentsEmpty"] as const) {
      setScenario(scenario);
      expect((await list("pet")).items).toEqual(scenario === "memberAppointmentsEmpty" ? contract.members[0].pets : []);
      expect((await list("appointment_request")).items).toEqual(scenario === "memberPetsEmpty" ? contract.members[0].appointmentRequests : []);
    }
    setScenario("rateLimited");
    expect((await list("pet")).items).toEqual(contract.members[0].pets);
    const limited = await post(contract.createCases.valid.request);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    setScenario("error500");
    expect((await raw("/content-types/pet/entries")).status).toBe(500);
  });
});
