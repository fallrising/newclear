// @cms/api/public — the only entry point web-front may import (01 §4.1, surface-front AC-08).
// It must not import work.ts or admin.ts, directly or indirectly.
import { queryOptions } from "@tanstack/react-query";
import { keys as baseKeys } from "./keys";
import type { components } from "./schema";
import { authApi } from "./auth";
import { createTransport, type Transport, type TransportOptions } from "./core";
import { publicApi } from "./public";

export { ApiError, isApiError, type ApiErrorCode } from "./errors";
export type { PublicListParams } from "./keys";
export { publicQueries, type PublicApi } from "./public";
export type { AuthApi } from "./auth";
export type { ErrorCode, LoginResponse, MediaAsset, Me, PublicEntry, PublicEntryPage, Surface } from "./schema";

export function createFrontClient(options: TransportOptions) {
  const transport = createTransport(options);
  return { url: transport.url, auth: authApi(transport), public: publicApi(transport), member: memberApi(transport) };
}

export type FrontClient = ReturnType<typeof createFrontClient>;

export type MemberEntry = components["schemas"]["MemberEntry"];
export type MemberEntryPage = components["schemas"]["MemberEntryPage"];
export type MemberCreateRequest = components["schemas"]["MemberCreateRequest"];

export interface MemberListParams {
  page?: number;
  size?: number;
  sort?: string;
}

export interface AppointmentDraft {
  pet: string;
  preferredAt: string;
  reason: string;
}

export const keys = {
  ...baseKeys,
  member: {
    list: (type: string, params: MemberListParams) => ["member", "entries", type, params] as const,
    detail: (id: string) => ["member", "entry", id] as const,
  },
};

function memberApi(t: Transport) {
  return {
    list(type: string, params: MemberListParams, signal?: AbortSignal): Promise<MemberEntryPage> {
      return t.call(() => t.client.GET("/api/v1/me/content-types/{typeKey}/entries", {
        params: { path: { typeKey: type }, query: { page: params.page, size: params.size, sort: params.sort } },
        signal,
      }));
    },
    detail(id: string, signal?: AbortSignal): Promise<MemberEntry> {
      return t.call(() => t.client.GET("/api/v1/me/entries/{id}", { params: { path: { id } }, signal }));
    },
    createAppointment(payload: AppointmentDraft): Promise<MemberEntry> {
      return t.call(() => t.client.POST("/api/v1/me/content-types/{typeKey}/entries", {
        params: { path: { typeKey: "appointment_request" } },
        body: { payload: { pet: payload.pet, preferredAt: payload.preferredAt, reason: payload.reason } },
      }));
    },
  };
}

export const memberQueries = {
  list: (client: FrontClient, type: string, params: MemberListParams) =>
    queryOptions({ queryKey: keys.member.list(type, params), queryFn: ({ signal }) => client.member.list(type, params, signal) }),
  detail: (client: FrontClient, id: string) =>
    queryOptions({ queryKey: keys.member.detail(id), queryFn: ({ signal }) => client.member.detail(id, signal) }),
};

export async function createAppointment(client: FrontClient, payload: AppointmentDraft): Promise<MemberEntry> {
  return client.member.createAppointment(payload);
}
