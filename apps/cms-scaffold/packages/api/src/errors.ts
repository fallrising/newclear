import type { ErrorCode } from "./schema";

/** Codes produced by the client itself, never by the server. */
export type ClientErrorCode = "NETWORK_ERROR" | "INVALID_RESPONSE";

export type ApiErrorCode = ErrorCode | ClientErrorCode;

/** The only error type thrown by @cms/api. `message` is a developer message, never shown to users. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requestId: string | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Turns an error response body into ApiError. Bodies that are not an ErrorEnvelope become INVALID_RESPONSE (C-18). */
export function errorFromBody(status: number, body: unknown): ApiError {
  if (body && typeof body === "object" && "error" in body) {
    const envelope = body as { error?: { code?: unknown; message?: unknown }; requestId?: unknown };
    const code = envelope.error?.code;
    if (typeof code === "string") {
      const message = typeof envelope.error?.message === "string" ? envelope.error.message : "";
      const requestId = typeof envelope.requestId === "string" ? envelope.requestId : undefined;
      return new ApiError(status, code as ErrorCode, message, requestId);
    }
  }
  return new ApiError(status, "INVALID_RESPONSE", `HTTP ${status} without an error envelope`);
}
