// RunManifest v1 and its detached owner approval (SDD 05 §4).
// Go twin: agent/internal/contract/runmanifest.go. Vectors: contracts/vectors/run-approval.json.

import { concatBytes, ed25519Verify, fromBase64Url, sha256, toHex, utf8Encode } from "./bytes.ts";
import { ContractError, HEX64, B64URL_NONCE, checkShape, idPattern, int, oneOf, str, time, utf8Length } from "./fields.ts";
import { parseStrictJson, type JsonObject } from "./strictJson.ts";

export const RUN_MANIFEST_MAX_BYTES = 32 * 1024;
export const APPROVAL_MAX_BYTES = 4 * 1024;
export const RUN_SIGNING_DOMAIN = "EDGEOPS-RUN-V1\n";
export const MAX_APPROVAL_WINDOW_SECONDS = 24 * 3600;
export const EXECUTION_PROFILES = ["unprivileged-diagnostic", "privileged"] as const;

const RUN_FIELDS = [
  "schema_version",
  "workspace_id",
  "job_id",
  "attempt_id",
  "node_id",
  "enrollment_generation",
  "recipe_version",
  "artifact_sha256",
  "parameters",
  "execution_profile",
  "policy_digest",
  "timeout_seconds",
  "not_before",
  "expires_at",
  "nonce",
] as const;

const APPROVAL_FIELDS = ["schema_version", "key_id", "manifest_sha256", "signature"] as const;

const PARAM_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const RECIPE_VERSION = /^[a-z0-9][a-z0-9-]{0,62}@[1-9][0-9]{0,8}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
export const KEY_ID = idPattern("key");

export type ParamValue = string | number | boolean;

export interface RunManifest {
  workspace_id: string;
  job_id: string;
  attempt_id: string;
  node_id: string;
  enrollment_generation: number;
  recipe_version: string;
  artifact_sha256: string;
  parameters: Record<string, ParamValue>;
  execution_profile: (typeof EXECUTION_PROFILES)[number];
  policy_digest: string;
  timeout_seconds: number;
  not_before: number;
  expires_at: number;
  nonce: string;
}

export interface RunApproval {
  key_id: string;
  manifest_sha256: string;
  signature: Uint8Array;
}

export function parseRunManifest(bytes: Uint8Array): RunManifest {
  const doc = checkShape(parseStrictJson(bytes, RUN_MANIFEST_MAX_BYTES), "edgeops.run", 1, RUN_FIELDS);
  const m: RunManifest = {
    workspace_id: str(doc, "workspace_id", idPattern("ws")),
    job_id: str(doc, "job_id", idPattern("job")),
    attempt_id: str(doc, "attempt_id", idPattern("attempt")),
    node_id: str(doc, "node_id", idPattern("node")),
    enrollment_generation: int(doc, "enrollment_generation", 1, 2147483647),
    recipe_version: str(doc, "recipe_version", RECIPE_VERSION),
    artifact_sha256: str(doc, "artifact_sha256", HEX64),
    parameters: parameters(doc),
    execution_profile: oneOf(doc, "execution_profile", EXECUTION_PROFILES),
    policy_digest: str(doc, "policy_digest", HEX64),
    timeout_seconds: int(doc, "timeout_seconds", 1, 86400),
    not_before: time(doc, "not_before"),
    expires_at: time(doc, "expires_at"),
    nonce: str(doc, "nonce", B64URL_NONCE),
  };
  if (m.expires_at <= m.not_before || m.expires_at - m.not_before > MAX_APPROVAL_WINDOW_SECONDS) {
    throw new ContractError("invalid_field", "expires_at", "must be after not_before and within 24h of it");
  }
  return m;
}

function parameters(doc: JsonObject): Record<string, ParamValue> {
  const v = doc["parameters"];
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ContractError("invalid_field", "parameters", "must be an object");
  }
  const keys = Object.keys(v).sort();
  if (keys.length > 32) throw new ContractError("invalid_field", "parameters", "at most 32 parameters");
  const out: Record<string, ParamValue> = {};
  for (const k of keys) {
    const field = `parameters.${k}`;
    if (!PARAM_KEY.test(k)) throw new ContractError("invalid_field", field, "invalid parameter name");
    const p = v[k];
    if (typeof p === "string") {
      if (utf8Length(p) > 1024) throw new ContractError("invalid_field", field, "string longer than 1024 bytes");
    } else if (typeof p !== "number" && typeof p !== "boolean") {
      throw new ContractError("invalid_field", field, "must be string, integer or boolean");
    }
    out[k] = p;
  }
  return out;
}

export function parseRunApproval(bytes: Uint8Array): RunApproval {
  const doc = checkShape(parseStrictJson(bytes, APPROVAL_MAX_BYTES), "edgeops.approval", 1, APPROVAL_FIELDS);
  const key_id = str(doc, "key_id", KEY_ID);
  const manifest_sha256 = str(doc, "manifest_sha256", HEX64);
  const sig = fromBase64Url(str(doc, "signature", SIGNATURE));
  if (!sig || sig.length !== 64) throw new ContractError("invalid_field", "signature", "must be 64 bytes base64url");
  return { key_id, manifest_sha256, signature: sig };
}

/** Exact bytes an approver signs: domain separator followed by the raw SHA-256 of the manifest bytes. */
export async function runSigningMessage(manifestBytes: Uint8Array): Promise<Uint8Array> {
  return concatBytes(utf8Encode(RUN_SIGNING_DOMAIN), await sha256(manifestBytes));
}

export interface RunBinding {
  node_id: string;
  enrollment_generation: number;
  now: number;
}

/**
 * Verifies an approval over the stored manifest bytes, then its binding to this node.
 * The manifest is never re-serialized before verification.
 */
export async function verifyRunApproval(
  manifestBytes: Uint8Array,
  approvalBytes: Uint8Array,
  trustedKeys: ReadonlyMap<string, Uint8Array>,
  binding: RunBinding,
): Promise<RunManifest> {
  const approval = parseRunApproval(approvalBytes);
  const manifest = parseRunManifest(manifestBytes);
  const digest = await sha256(manifestBytes);
  if (toHex(digest) !== approval.manifest_sha256) {
    throw new ContractError("digest_mismatch", "manifest_sha256", "approval does not cover these manifest bytes");
  }
  const key = trustedKeys.get(approval.key_id);
  if (!key) throw new ContractError("untrusted_key", "key_id", "approval key is not pinned");
  const msg = concatBytes(utf8Encode(RUN_SIGNING_DOMAIN), digest);
  if (!(await ed25519Verify(key, approval.signature, msg))) {
    throw new ContractError("bad_signature", "signature", "approval signature does not verify");
  }
  checkRunBinding(manifest, binding);
  return manifest;
}

export function checkRunBinding(m: RunManifest, b: RunBinding): void {
  if (m.node_id !== b.node_id) throw new ContractError("node_mismatch", "node_id", "manifest targets another node");
  if (m.enrollment_generation !== b.enrollment_generation) {
    throw new ContractError("generation_mismatch", "enrollment_generation", "manifest targets another generation");
  }
  if (b.now < m.not_before) throw new ContractError("not_yet_valid", "not_before", "approval not yet valid");
  if (b.now >= m.expires_at) throw new ContractError("expired", "expires_at", "approval expired");
}
