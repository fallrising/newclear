// Machine request signatures, edgeops-req-v1 (SDD 05 §2, contracts/README.md#request-signatures).
// Go twin: agent/internal/contract/requestauth.go. Vectors: contracts/vectors/request-signing.json.

import { ed25519Verify, fromBase64Url, sha256, toHex, utf8Encode } from "./bytes.ts";
import { ContractError, B64URL_NONCE, HEX64, idPattern, parseUtcSeconds } from "./fields.ts";

export const REQUEST_SIGNING_DOMAIN = "EDGEOPS-REQ-V1";
export const CLOCK_SKEW_SECONDS = 120;
export const PURPOSES = ["telemetry", "logs", "jobs"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const H = {
  version: "edgeops-version",
  purpose: "edgeops-purpose",
  credential: "edgeops-credential",
  requestId: "edgeops-request-id",
  sentAt: "edgeops-sent-at",
  nonce: "edgeops-nonce",
  contentSha256: "edgeops-content-sha256",
  signature: "edgeops-signature",
} as const;

const REQUIRED = [H.purpose, H.credential, H.requestId, H.sentAt, H.nonce, H.contentSha256, H.signature] as const;

const HEADER_RULES: Record<(typeof REQUIRED)[number], RegExp> = {
  [H.purpose]: /^(telemetry|logs|jobs)$/,
  [H.credential]: idPattern("cred"),
  [H.requestId]: idPattern("req"),
  [H.sentAt]: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  [H.nonce]: B64URL_NONCE,
  [H.contentSha256]: HEX64,
  [H.signature]: /^[A-Za-z0-9_-]{86}$/,
};

const PATH = /^\/agent\/v1(\/[A-Za-z0-9_-]{1,64}){1,8}$/;
const QUERY_KEY = /^[a-z0-9_]{1,64}$/;
const QUERY_VALUE = /^[A-Za-z0-9_.~-]{0,256}$/;
const METHODS = ["GET", "POST"];

export interface SignedRequest {
  method: string;
  /** Raw path exactly as received, before any decoding. */
  path: string;
  /** Raw query without the leading `?`; empty when absent. */
  query: string;
  /** Header names must be lower-case. */
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface VerifiedRequest {
  purpose: Purpose;
  credentialId: string;
  requestId: string;
  sentAt: number;
  nonce: string;
  bodySha256: string;
}

export interface CanonicalFields {
  purpose: string;
  credentialId: string;
  method: string;
  path: string;
  query: string;
  requestId: string;
  sentAt: string;
  nonce: string;
  bodySha256: string;
}

export function canonicalRequest(f: CanonicalFields): string {
  return [
    REQUEST_SIGNING_DOMAIN,
    f.purpose,
    f.credentialId,
    f.method,
    f.path,
    f.query,
    f.requestId,
    f.sentAt,
    f.nonce,
    f.bodySha256,
  ].join("\n");
}

/** Senders must already use the canonical query form; verifiers reject rather than normalise. */
export function isCanonicalQuery(q: string): boolean {
  if (q === "") return true;
  let prev = "";
  for (const pair of q.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) return false;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (!QUERY_KEY.test(k) || !QUERY_VALUE.test(v) || k <= prev) return false;
    prev = k;
  }
  return true;
}

export async function verifyRequest(
  req: SignedRequest,
  expectedPurpose: Purpose,
  now: number,
  lookupKey: (credentialId: string) => Promise<Uint8Array | null>,
): Promise<VerifiedRequest> {
  const h = req.headers;
  if (h[H.version] === undefined) throw new ContractError("missing_header", H.version, "required");
  if (h[H.version] !== "1") throw new ContractError("bad_version", H.version, "unsupported signature version");
  for (const name of REQUIRED) {
    if (h[name] === undefined) throw new ContractError("missing_header", name, "required");
  }
  for (const name of REQUIRED) {
    if (!HEADER_RULES[name].test(h[name]!)) throw new ContractError("invalid_header", name, "malformed");
  }
  const sentAt = parseUtcSeconds(h[H.sentAt]!);
  if (sentAt === null) throw new ContractError("invalid_header", H.sentAt, "malformed");
  if (h[H.purpose] !== expectedPurpose) throw new ContractError("purpose_mismatch", H.purpose, "credential purpose not allowed here");
  if (!METHODS.includes(req.method)) throw new ContractError("method_not_allowed", "method", "unsupported method");
  if (!PATH.test(req.path)) throw new ContractError("non_canonical_path", "path", "path is not canonical");
  if (!isCanonicalQuery(req.query)) throw new ContractError("non_canonical_query", "query", "query is not canonical");
  const bodySha256 = toHex(await sha256(req.body));
  if (bodySha256 !== h[H.contentSha256]) throw new ContractError("body_digest_mismatch", H.contentSha256, "body digest mismatch");
  if (Math.abs(now - sentAt) > CLOCK_SKEW_SECONDS) throw new ContractError("clock_skew", H.sentAt, "outside ±120s");
  const key = await lookupKey(h[H.credential]!);
  if (!key) throw new ContractError("unknown_credential", H.credential, "credential is not active");
  const sig = fromBase64Url(h[H.signature]!);
  const msg = utf8Encode(
    canonicalRequest({
      purpose: h[H.purpose]!,
      credentialId: h[H.credential]!,
      method: req.method,
      path: req.path,
      query: req.query,
      requestId: h[H.requestId]!,
      sentAt: h[H.sentAt]!,
      nonce: h[H.nonce]!,
      bodySha256,
    }),
  );
  if (!sig || !(await ed25519Verify(key, sig, msg))) throw new ContractError("bad_signature", H.signature, "signature does not verify");
  return {
    purpose: expectedPurpose,
    credentialId: h[H.credential]!,
    requestId: h[H.requestId]!,
    sentAt,
    nonce: h[H.nonce]!,
    bodySha256,
  };
}
