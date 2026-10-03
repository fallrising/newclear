// HTTP error mapping for the loopback demo Worker. M0 parser errors keep their contract codes.

import { ContractError } from "../domain/contract/fields.ts";
import { StrictJsonError } from "../domain/contract/strictJson.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new HttpError(422, "invalid_payload", message);
}

/** Strict JSON violations are malformed input (400/413); contract violations are 422. */
export function fromContract(err: unknown): unknown {
  if (err instanceof StrictJsonError) {
    return err.code === "too_large" ? new HttpError(413, "payload_too_large", err.message) : new HttpError(400, `strict_json_${err.code}`, err.message);
  }
  if (err instanceof ContractError) return new HttpError(422, err.code, err.message);
  return err;
}
