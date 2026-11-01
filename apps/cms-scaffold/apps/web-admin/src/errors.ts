import { isApiError } from "@cms/api";
import { copy } from "./copy";

/**
 * The toast text for a failed governance write (surface-admin §4.5: 403 is a toast and the page stays; never shown
 * as 404). Call sites check their own specific codes first and fall back to this.
 */
export function failureText(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === "LAST_ADMIN") return copy["error.lastAdmin"];
    if (error.status === 403) return copy["error.forbidden"];
  }
  return copy["error.failed"];
}

/** 404 of a detail query → the router's /404; 403 → /403; anything else stays on the page as ErrorState. */
export function redirectFor(error: unknown): "/404" | "/403" | null {
  if (!isApiError(error)) return null;
  if (error.status === 404) return "/404";
  if (error.status === 403) return "/403";
  return null;
}
