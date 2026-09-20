import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { hashBotToken } from "../src/token.ts";
import { CSRF_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS, type Env } from "./env.ts";
import { errorBody } from "./errors.ts";

export type SessionData = { member_id: string; expires_at: string };

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function readSession(env: Env, sessionId: string | undefined): Promise<SessionData | null> {
  if (!sessionId) return null;
  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) return null;
  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
  if (typeof data.member_id !== "string" || typeof data.expires_at !== "string") return null;
  if (Date.parse(data.expires_at) <= Date.now()) {
    await env.SESSIONS.delete(`session:${sessionId}`);
    return null;
  }
  return data;
}

export async function createSession(env: Env, memberId: string): Promise<string> {
  const id = randomToken(32);
  const expires_at = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.SESSIONS.put(`session:${id}`, JSON.stringify({ member_id: memberId, expires_at } satisfies SessionData), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function destroySession(env: Env, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await env.SESSIONS.delete(`session:${sessionId}`);
}

export function setSessionCookie(c: Context<{ Bindings: Env }>, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function setCsrfCookie(c: Context<{ Bindings: Env }>, token: string): void {
  setCookie(c, CSRF_COOKIE, token, {
    path: "/",
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function csrfOk(c: Context<{ Bindings: Env }>): boolean {
  const cookie = getCookie(c, CSRF_COOKIE) ?? "";
  const header = c.req.header("X-CSRF-Token") ?? "";
  return cookie.length > 0 && header.length > 0 && cookie === header;
}

export function authorizationBearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function unauthorized(c: Context<{ Bindings: Env }>, message = "unauthorized"): Response {
  return c.json(errorBody("unauthorized", message), 401);
}

export function forbidden(c: Context<{ Bindings: Env }>, message = "forbidden"): Response {
  return c.json(errorBody("forbidden", message), 403);
}

export function invalid(c: Context<{ Bindings: Env }>, message = "invalid request"): Response {
  return c.json(errorBody("invalid_request", message), 400);
}

export type MemberRow = {
  id: string;
  kind: string;
  handle: string;
  display_name: string;
  password_hash: string | null;
  capabilities_json: string;
  quota_class: string;
  is_operator: number;
  disabled_at: string | null;
};

export async function loadMember(env: Env, memberId: string): Promise<MemberRow | null> {
  return env.DB.prepare(
    `SELECT id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, disabled_at
     FROM members WHERE id = ?`,
  )
    .bind(memberId)
    .first<MemberRow>();
}

export async function requireSession(
  c: Context<{ Bindings: Env }>,
): Promise<{ session: SessionData; member: MemberRow } | Response> {
  const session = await readSession(c.env, getCookie(c, SESSION_COOKIE));
  if (!session) return unauthorized(c);
  const member = await loadMember(c.env, session.member_id);
  if (!member || member.disabled_at) return unauthorized(c);
  return { session, member };
}

export type AuthOk = {
  member: MemberRow;
  via: "session" | "bearer";
  session: SessionData | null;
};

type BotTokenRow = {
  id: string;
  member_id: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export async function requireAuth(c: Context<{ Bindings: Env }>): Promise<AuthOk | Response> {
  const token = authorizationBearer(c);
  if (token != null) {
    if (token.length === 0) return unauthorized(c);
    const tokenHash = await hashBotToken(token);
    const row = await c.env.DB.prepare(
      `SELECT id, member_id, expires_at, revoked_at FROM bot_tokens WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .first<BotTokenRow>();
    if (!row) return unauthorized(c);
    if (row.revoked_at) return c.json(errorBody("token_revoked", "token revoked"), 401);
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
      return c.json(errorBody("token_revoked", "token expired"), 401);
    }
    const member = await loadMember(c.env, row.member_id);
    if (!member || member.disabled_at || member.kind !== "agent") return unauthorized(c);
    await c.env.DB.prepare(`UPDATE bot_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), row.id)
      .run();
    return { member, via: "bearer", session: null };
  }
  const sessionAuth = await requireSession(c);
  if (sessionAuth instanceof Response) return sessionAuth;
  return { member: sessionAuth.member, via: "session", session: sessionAuth.session };
}

export async function requireOperator(c: Context<{ Bindings: Env }>): Promise<AuthOk | Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  if (auth.via !== "session" || auth.member.is_operator !== 1) {
    return forbidden(c, "operator required");
  }
  return auth;
}

export async function isRoomMember(env: Env, roomId: string, memberId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM room_members WHERE room_id = ? AND member_id = ?`,
  )
    .bind(roomId, memberId)
    .first<{ ok: number }>();
  return row != null;
}

export async function roomExists(env: Env, roomId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(roomId).first<{ id: string }>();
  return row != null;
}
