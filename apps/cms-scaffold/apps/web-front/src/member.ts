import type { MemberEntry } from "@cms/api/public";
import type { CopyKey } from "./copy";
export const MEMBER_LIST_SIZE = 100;
export const PET_TYPE = "pet";
export const APPOINTMENT_TYPE = "appointment_request";
export function memberText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : "";
}
export function petTitle(pets: MemberEntry[], petId: unknown): string | null {
  return pets.find((pet) => pet.id === petId)?.title || null;
}
export function appointmentStatus(entry: MemberEntry): CopyKey {
  const state = entry.publicationState;
  return state === "published" ? "member.status.confirmed" : state === "archived" ? "member.status.closed" : "member.status.pending";
}
export function formatMemberDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeStyle: "short" }).format(date) : null;
}
export function localDateTimeToIso(value: string): string | null {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function currentLocalMinute(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid date");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
