import type { CopyKey } from "../copy";
import { ApiError } from "./client";

export function errorCopyKey(error: unknown): CopyKey {
  if (error instanceof ApiError) {
    if (error.code === "network_error") return "error.code.network_error";
    if (error.status === 401) return "error.code.unauthorized";
  }
  return "error.code.unknown";
}
