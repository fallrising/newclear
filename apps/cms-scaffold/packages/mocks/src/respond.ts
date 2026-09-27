import { HttpResponse } from "msw";
import type { ErrorCode, ErrorEnvelope } from "@cms/api";

let counter = 0;

export function apiError(status: number, code: ErrorCode, message: string) {
  counter += 1;
  const body: ErrorEnvelope = { error: { code, message }, requestId: `mock-${counter}` };
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
