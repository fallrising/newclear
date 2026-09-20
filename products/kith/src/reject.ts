import { BODY_MAX_BYTES, MEMBERS_PER_ROOM, STATUS_MAX_BYTES, WAKE_PER_MINUTE } from "./caps.ts";

export type RejectOk = { ok: true };
export type PayloadReject = { ok: false; code: "payload_too_large" };
export type RoomFullReject = { ok: false; code: "room_full" };
export type WakeBudgetReject = { ok: false; code: "wake_budget_exhausted" };

export function rejectBody(bytes: number): RejectOk | PayloadReject {
  if (bytes > BODY_MAX_BYTES) return { ok: false, code: "payload_too_large" };
  return { ok: true };
}

export function rejectStatus(bytes: number): RejectOk | PayloadReject {
  if (bytes > STATUS_MAX_BYTES) return { ok: false, code: "payload_too_large" };
  return { ok: true };
}

export function rejectMemberCount(count: number): RejectOk | RoomFullReject {
  if (count > MEMBERS_PER_ROOM) return { ok: false, code: "room_full" };
  return { ok: true };
}

/** 7th wake in a 6-budget window is rejected. consumedInWindow is successful dispatches already counted. */
export function consumeWake(
  consumedInWindow: number,
): { ok: true; consumed: number } | WakeBudgetReject {
  if (consumedInWindow >= WAKE_PER_MINUTE) {
    return { ok: false, code: "wake_budget_exhausted" };
  }
  return { ok: true, consumed: consumedInWindow + 1 };
}
