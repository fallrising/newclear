import type { CopyKey } from "../copy";
import { ApiError } from "./client";

const CODE_KEYS: Record<string, CopyKey> = {
  payload_too_large: "error.code.payload_too_large",
  forbidden: "error.code.forbidden",
  invalid_request: "error.code.invalid_request",
  network_error: "error.code.network_error",
  unauthorized: "error.code.unauthorized",
  room_archived: "error.code.room_archived",
  wrong_password: "error.code.wrong_password",
  handle_taken: "error.code.handle_taken",
  already_member: "error.code.already_member",
  room_full: "error.code.room_full",
  not_found: "error.code.not_found",
  in_use: "error.code.in_use",
  name_taken: "error.code.name_taken",
  provider_disabled: "error.code.provider_disabled",
  secrets_key_missing: "error.code.secrets_key_missing",
  secret_unavailable: "error.code.secret_unavailable",
};

/** Copy key for an error, or for a server error code string (WS `error` frames, failed sends). */
export function errorCopyKey(error: unknown): CopyKey {
  if (typeof error === "string") return CODE_KEYS[error] ?? "error.code.unknown";
  if (error instanceof ApiError) {
    if (error.code === "network_error") return "error.code.network_error";
    const mapped = CODE_KEYS[error.code];
    if (mapped) return mapped;
    if (error.status === 401) return "error.code.unauthorized";
  }
  return "error.code.unknown";
}
