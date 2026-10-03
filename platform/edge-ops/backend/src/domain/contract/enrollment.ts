// Enrollment request v1 (SDD 05 §2). Go twin: agent/internal/contract/enrollment.go.
// The proof binds the locally generated node key to one enrollment token so a replay with
// another key cannot mint a second identity.

import { concatBytes, ed25519Verify, fromBase64Url, sha256, toHex, utf8Encode } from "./bytes.ts";
import { ContractError, checkShape, oneOf, str } from "./fields.ts";
import { parseStrictJson } from "./strictJson.ts";

export const ENROLL_MAX_BYTES = 4 * 1024;
export const ENROLL_SIGNING_DOMAIN = "EDGEOPS-ENROLL-V1\n";

const FIELDS = ["schema_version", "enrollment_token", "public_key", "proof", "agent_version", "os", "arch"] as const;
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 256-bit, unpadded base64url
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const AGENT_VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,32})?$/;

export interface EnrollRequest {
  tokenHash: string;
  publicKey: Uint8Array;
  publicKeyB64: string;
  agentVersion: string;
  os: "linux";
  arch: "amd64" | "arm64";
}

/** The token hash is also the lookup key stored server-side; the raw token is never persisted. */
export async function enrollmentTokenHash(token: string): Promise<string> {
  return toHex(await sha256(utf8Encode(token)));
}

export async function enrollSigningMessage(token: string, publicKey: Uint8Array): Promise<Uint8Array> {
  return concatBytes(utf8Encode(ENROLL_SIGNING_DOMAIN), await sha256(utf8Encode(token)), publicKey);
}

export async function parseAndVerifyEnroll(bytes: Uint8Array): Promise<EnrollRequest> {
  const doc = checkShape(parseStrictJson(bytes, ENROLL_MAX_BYTES), "edgeops.enroll", 1, FIELDS);
  const token = str(doc, "enrollment_token", TOKEN);
  const publicKeyB64 = str(doc, "public_key", PUBLIC_KEY);
  const proofB64 = str(doc, "proof", SIGNATURE);
  const agentVersion = str(doc, "agent_version", AGENT_VERSION);
  const os = oneOf(doc, "os", ["linux"] as const);
  const arch = oneOf(doc, "arch", ["amd64", "arm64"] as const);
  const publicKey = fromBase64Url(publicKeyB64);
  if (!publicKey || publicKey.length !== 32) throw new ContractError("invalid_field", "public_key", "must be 32 bytes");
  if (!fromBase64Url(token)) throw new ContractError("invalid_field", "enrollment_token", "non-canonical base64url");
  const proof = fromBase64Url(proofB64);
  if (!proof || !(await ed25519Verify(publicKey, proof, await enrollSigningMessage(token, publicKey)))) {
    throw new ContractError("bad_signature", "proof", "proof of key possession does not verify");
  }
  return { tokenHash: await enrollmentTokenHash(token), publicKey, publicKeyB64, agentVersion, os, arch };
}
