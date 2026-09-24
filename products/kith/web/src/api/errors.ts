import type { CopyKey } from "../copy";
import { ApiError } from "./client";

const CODE_KEYS: Record<string, CopyKey> = {
  payload_too_large: "error.code.payload_too_large",
  forbidden: "error.code.forbidden",
  invalid_request: "error.code.invalid_request",
  network_error: "error.code.network_error",
  unauthorized: "error.code.unauthorized",
};

/** Copy key for an error, or for a server error code string (WS `error` frames, failed sends). */
export function errorCopyKey(error: unknown): CopyKey {
  if (typeof error === "string") return CODE_KEYS[error] ?? "error.code.unknown";
  if (error instanceof ApiError) {
    if (error.code === "network_error") return "error.code.network_error";
    if (error.status === 401) return "error.code.unauthorized";
  }
  return "error.code.unknown";
}
