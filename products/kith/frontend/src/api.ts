import { normalizeTimelineEvent } from "./protocol";
import type { Member, ReplyLimit, Room, TimelineEvent } from "./types";

export const CSRF_HEADER = "X-CSRF-Token";

const CSRF_COOKIE_NAMES = [
  "csrf",
  "csrf_token",
  "csrf-token",
  "CSRF-Token",
  "X-CSRF-Token",
  "XSRF-TOKEN",
  "__Host-csrf",
];

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listFrom(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!isRecord(data)) {
    return [];
  }
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function errorFromBody(status: number, data: unknown, fallback: string): ApiError {
  if (isRecord(data) && isRecord(data.error)) {
    const code = typeof data.error.code === "string" ? data.error.code : undefined;
    const message =
      typeof data.error.message === "string" && data.error.message
        ? data.error.message
        : code ?? fallback;
    return new ApiError(status, message, code);
  }
  return new ApiError(status, fallback);
}

async function errorFromResponse(res: Response, text: string): Promise<ApiError> {
  const fallback = `HTTP ${res.status}`;
  if (!text) {
    return new ApiError(res.status, fallback);
  }
  try {
    return errorFromBody(res.status, JSON.parse(text) as unknown, fallback);
  } catch {
    return new ApiError(res.status, fallback);
  }
}

export function readCookie(name: string): string | null {
  const encoded = encodeURIComponent(name);
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (key === name || key === encoded) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

function tokenFromCookies(): string | null {
  for (const name of CSRF_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) {
      return value;
    }
  }
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (/csrf/i.test(key)) {
      const value = decodeURIComponent(trimmed.slice(eq + 1));
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function tokenFromJson(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }
  for (const key of ["token", "csrf", "csrf_token", "csrfToken"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/** GET /api/csrf then read the CSRF cookie (header must match that cookie). */
export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf", { credentials: "include", cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw await errorFromResponse(res, text);
  }
  let bodyToken: string | null = null;
  if (text) {
    try {
      bodyToken = tokenFromJson(JSON.parse(text) as unknown);
    } catch {
      const trimmed = text.trim();
      if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("<")) {
        bodyToken = trimmed;
      }
    }
  }
  const headerToken = res.headers.get(CSRF_HEADER) ?? res.headers.get("X-CSRF-TOKEN");
  const cookieToken = tokenFromCookies();
  const token = cookieToken ?? bodyToken ?? headerToken;
  if (!token) {
    throw new ApiError(res.status, "CSRF token missing from cookie");
  }
  return token;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(path, { ...init, credentials: "include" });
  if (res.status === 204) {
    return null;
  }
  const text = await res.text();
  if (!res.ok) {
    throw await errorFromResponse(res, text);
  }
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function login(handle: string, password: string): Promise<unknown> {
  const token = await fetchCsrfToken();
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set(CSRF_HEADER, token);
  return request("/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ handle, password }),
  });
}

export async function logout(): Promise<void> {
  const token = await fetchCsrfToken();
  const headers = new Headers();
  headers.set(CSRF_HEADER, token);
  await request("/api/auth/logout", { method: "POST", headers });
}

export async function getMe(signal?: AbortSignal): Promise<unknown> {
  return request("/api/me", { signal });
}

export function parseRooms(data: unknown): Room[] {
  return listFrom(data, ["rooms", "items", "data"]).flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      return [];
    }
    const room: Room = {
      id: item.id,
      name: typeof item.name === "string" ? item.name : undefined,
      slug: typeof item.slug === "string" ? item.slug : undefined,
    };
    if (typeof item.role === "string") {
      room.role = item.role;
    }
    return [room];
  });
}

export function parseMe(data: unknown): { isOperator: boolean; handle: string } {
  if (!isRecord(data)) {
    return { isOperator: false, handle: "" };
  }
  return {
    isOperator: data.is_operator === 1 || data.is_operator === true,
    handle: typeof data.handle === "string" ? data.handle : "",
  };
}

function roomFromRecord(data: unknown): Room {
  if (!isRecord(data) || typeof data.id !== "string") {
    throw new ApiError(200, "Invalid room");
  }
  const room: Room = {
    id: data.id,
    name: typeof data.name === "string" ? data.name : undefined,
    slug: typeof data.slug === "string" ? data.slug : undefined,
  };
  if (typeof data.role === "string") {
    room.role = data.role;
  }
  return room;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const token = await fetchCsrfToken();
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set(CSRF_HEADER, token);
  return request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

export async function listRooms(signal?: AbortSignal): Promise<Room[]> {
  return parseRooms(await request("/api/rooms", { signal }));
}

export async function createRoom(name: string, slug: string): Promise<Room> {
  return roomFromRecord(await postJson("/api/rooms", { name, slug }));
}

export async function inviteHuman(roomId: string, handle: string): Promise<string> {
  const data = await postJson(`/api/rooms/${encodeURIComponent(roomId)}/members`, { handle });
  if (!isRecord(data) || typeof data.member_id !== "string") {
    throw new ApiError(200, "Invalid invite");
  }
  return data.member_id;
}

export async function listMessages(
  roomId: string,
  query: { limit?: number; after_seq?: number } = {},
  signal?: AbortSignal,
): Promise<TimelineEvent[]> {
  const params = new URLSearchParams();
  if (query.limit != null) {
    params.set("limit", String(query.limit));
  }
  if (query.after_seq != null) {
    params.set("after_seq", String(query.after_seq));
  }
  const qs = params.toString();
  const path = `/api/rooms/${encodeURIComponent(roomId)}/messages${qs ? `?${qs}` : ""}`;
  const data = await request(path, { signal });
  return listFrom(data, ["messages", "items", "data", "events"]).flatMap((item) => {
    const event = normalizeTimelineEvent(item);
    return event ? [event] : [];
  });
}

function parseReplyLimit(value: unknown): ReplyLimit {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value) || (value.code !== "fixed" && value.code !== "sidecar_off")) {
    return null;
  }
  if (value.code === "sidecar_off") {
    return { code: "sidecar_off" };
  }
  if (typeof value.fixed_text !== "string" || !value.fixed_text) {
    return null;
  }
  return { code: "fixed", fixed_text: value.fixed_text };
}

export function parseMembers(data: unknown): Member[] {
  return listFrom(data, ["members", "items", "data"]).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.member_id === "string"
          ? item.member_id
          : null;
    if (!id) {
      return [];
    }
    return [
      {
        id,
        handle: typeof item.handle === "string" ? item.handle : undefined,
        display_name: typeof item.display_name === "string" ? item.display_name : undefined,
        kind: typeof item.kind === "string" ? item.kind : undefined,
        quota_class: typeof item.quota_class === "string" ? item.quota_class : undefined,
        attention_mode: typeof item.attention_mode === "string" ? item.attention_mode : undefined,
        operator_only: typeof item.operator_only === "boolean" ? item.operator_only : undefined,
        reply_limit: parseReplyLimit(item.reply_limit),
      },
    ];
  });
}

export async function listMembers(roomId: string, signal?: AbortSignal): Promise<Member[]> {
  const path = `/api/rooms/${encodeURIComponent(roomId)}/members`;
  return parseMembers(await request(path, { signal }));
}
