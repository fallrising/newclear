import { HttpResponse } from "msw";
import type { ErrorCode, ErrorEnvelope, FieldError } from "@cms/api";

let counter = 0;

export function apiError(status: number, code: ErrorCode, message: string, fields?: FieldError[]) {
  counter += 1;
  const body: ErrorEnvelope = { error: { code, message, ...(fields?.length ? { fields } : {}) }, requestId: `mock-${counter}` };
  return HttpResponse.json(body, { status });
}

/** 1×1 grey PNG served for every media variant. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4+P//fwAJ0APXJRfBXgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export function png() {
  return new HttpResponse(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
}
