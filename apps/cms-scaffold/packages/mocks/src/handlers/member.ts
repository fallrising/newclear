import { http, HttpResponse } from "msw";
import type { FieldError, Me, components } from "@cms/api";
import { db } from "../db";
import { currentUser } from "../guards";
import { apiError } from "../respond";
import { getState } from "../state";

type MemberEntry = components["schemas"]["MemberEntry"];
type MemberEntryPage = components["schemas"]["MemberEntryPage"];

function requireUser(): Me | Response {
  const user = currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Authentication required");
  if (getState().surface !== "front") return apiError(403, "SURFACE_FORBIDDEN", "Front surface required");
  return user;
}

function memberFor(user: Me) {
  return db.memberEntries.members.find((member) => member.principal.id === user.principal.id);
}

function typeError(type: string) {
  return !["pet", "appointment_request"].includes(type)
    ? apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found") : null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidField(field: string, code: FieldError["code"]): FieldError {
  return { field: `payload.${field}`, code, message: "Invalid value" };
}

export const memberHandlers = [
  http.get("*/api/v1/me/content-types/:type/entries", ({ request, params }) => {
    const user = requireUser();
    if (user instanceof Response) return user;
    const type = String(params.type);
    const error = typeError(type);
    if (error) return error;
    const url = new URL(request.url);
    const pageValue = url.searchParams.get("page") ?? "1";
    const sizeValue = url.searchParams.get("size") ?? "20";
    const page = Number(pageValue);
    const size = Number(sizeValue);
    if (!/^\d+$/.test(pageValue) || !/^\d+$/.test(sizeValue) || !Number.isSafeInteger(page) || page < 1 || size < 1 || size > 100 || url.searchParams.has("state")) {
      return apiError(400, "VALIDATION_FAILED", "Invalid list parameters");
    }
    const { scenario } = getState();
    const empty = scenario === "empty" || (type === "pet" && scenario === "memberPetsEmpty") || (type === "appointment_request" && scenario === "memberAppointmentsEmpty");
    const member = memberFor(user);
    const entries: MemberEntry[] = empty ? [] : (type === "pet" ? member?.pets : member?.appointmentRequests) ?? [];
    const offset = (page - 1) * size;
    return HttpResponse.json<MemberEntryPage>({ items: entries.slice(offset, offset + size), total: entries.length, page, size, offset, limit: size });
  }),

  http.get("*/api/v1/me/entries/:id", ({ params }) => {
    const user = requireUser();
    if (user instanceof Response) return user;
    for (const member of db.memberEntries.members) {
      const entry = [...member.pets, ...member.appointmentRequests].find((item) => item.id === params.id);
      if (!entry || typeError(entry.contentType)) continue;
      if (member.principal.id !== user.principal.id) return apiError(403, "FORBIDDEN", "Missing permission");
      return HttpResponse.json<MemberEntry>(entry);
    }
    return apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }),

  http.post("*/api/v1/me/content-types/:type/entries", async ({ request, params }) => {
    const user = requireUser();
    if (user instanceof Response) return user;
    const type = String(params.type);
    const error = typeError(type);
    if (error) return error;
    if (type !== "appointment_request") return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    if (getState().scenario === "rateLimited") return apiError(429, "RATE_LIMITED", "Rate limit exceeded");
    const body: unknown = await request.json().catch(() => null);
    if (!object(body) || Object.keys(body).some((key) => key !== "payload") || !object(body.payload)) {
      return apiError(400, "VALIDATION_FAILED", "Invalid request body");
    }
    const payload = body.payload;
    if (Object.keys(payload).some((key) => !["pet", "preferredAt", "reason"].includes(key))) return apiError(400, "VALIDATION_FAILED", "Invalid request body");
    const fields: FieldError[] = [];
    if (typeof payload.pet !== "string" || !payload.pet.trim()) fields.push(invalidField("pet", "REQUIRED"));
    if (typeof payload.preferredAt !== "string" || !payload.preferredAt.trim() || !Number.isFinite(Date.parse(payload.preferredAt))) fields.push(invalidField("preferredAt", "INVALID_DATETIME"));
    if (typeof payload.reason !== "string" || !payload.reason.trim()) fields.push(invalidField("reason", "REQUIRED"));
    else if (payload.reason.trim().length > 1000) fields.push(invalidField("reason", "TOO_LONG"));
    if (fields.length) return apiError(422, "FIELD_VALIDATION", "Invalid fields", fields);
    const member = memberFor(user);
    if (!member?.pets.some((pet) => pet.id === payload.pet)) {
      const foreign = db.memberEntries.createCases.foreignPet;
      return apiError(foreign.expectedStatus, foreign.expectedErrorCode, "Reference target not found", [invalidField("pet", "REF_TARGET_NOT_FOUND")]);
    }
    // Only the declared fixture case has a fixed response; never substitute A's data for another owner.
    const valid = db.memberEntries.createCases.valid;
    const expected = valid.request.payload;
    if (user.principal.username !== valid.actorUsername || payload.pet !== expected.pet || payload.reason !== expected.reason || Date.parse(payload.preferredAt as string) !== Date.parse(expected.preferredAt as string)) {
      return apiError(422, "FIELD_VALIDATION", "No matching fixture create case", [invalidField("reason", "INVALID_FORMAT")]);
    }
    const created = structuredClone(valid.response);
    member.appointmentRequests.push(created);
    return HttpResponse.json<MemberEntry>(created, { status: 201 });
  }),
];
