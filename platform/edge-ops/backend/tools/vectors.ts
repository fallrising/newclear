// Generates the signed cross-implementation vectors in contracts/vectors/.
// All keys derive from public, test-only seed labels; they must never be trusted anywhere.
// Run `npm run vectors` to rewrite; `npm test` fails if the committed files drift.

import { ed25519PublicFromSeed, ed25519SignWithSeed, sha256, toBase64Url, toHex, utf8Encode } from "../src/domain/contract/bytes.ts";
import { enrollSigningMessage } from "../src/domain/contract/enrollment.ts";
import { canonicalRequest, H } from "../src/domain/contract/requestAuth.ts";
import { runSigningMessage } from "../src/domain/contract/runManifest.ts";

export const SEED_PREFIX = "edgeops-test-vector-seed:";

export async function seed(label: string): Promise<Uint8Array> {
  return sha256(utf8Encode(SEED_PREFIX + label));
}

async function publicKey(label: string): Promise<string> {
  return toBase64Url(await ed25519PublicFromSeed(await seed(label)));
}

// Ed25519 group order L, little-endian; S + L is the classic non-canonical signature.
const L = fromHexLE("1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
function fromHexLE(bigEndianHex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[31 - i] = parseInt(bigEndianHex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function addL(sig: Uint8Array): Uint8Array {
  const out = sig.slice();
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const v = out[32 + i]! + L[i]! + carry;
    out[32 + i] = v & 0xff;
    carry = v >> 8;
  }
  return out;
}

// ---------- run approvals ----------

type SigningVariant = "standard" | "no_domain" | "noncanonical_s";

interface RunCaseInput {
  name: string;
  manifest: string;
  /** Manifest bytes the approval covers; defaults to `manifest`. */
  signedManifest?: string;
  signer?: string;
  keyId?: string;
  variant?: SigningVariant;
  approvalOverride?: (fields: { key_id: string; manifest_sha256: string; signature: string }) => string;
  binding?: Partial<{ node_id: string; enrollment_generation: number; now: string }>;
  expect: { ok: true } | { ok: false; code: string; field?: string };
}

const BASE_MANIFEST = {
  schema_version: "edgeops.run.v1",
  workspace_id: "ws_example",
  job_id: "job_example",
  attempt_id: "attempt_example",
  node_id: "node_example",
  enrollment_generation: 1,
  recipe_version: "service-status@1",
  artifact_sha256: "a".repeat(64),
  parameters: { unit: "example.service", lines: 50, follow: false },
  execution_profile: "unprivileged-diagnostic",
  policy_digest: "b".repeat(64),
  timeout_seconds: 30,
  not_before: "2026-01-01T00:00:00Z",
  expires_at: "2026-01-01T01:00:00Z",
  nonce: "AAAAAAAAAAAAAAAAAAAAAA",
} as const;

const manifest = (patch: Record<string, unknown> = {}, drop: string[] = []): string => {
  const m: Record<string, unknown> = { ...BASE_MANIFEST, ...patch };
  for (const k of drop) delete m[k];
  return JSON.stringify(m);
};

const DEFAULT_BINDING = { node_id: "node_example", enrollment_generation: 1, now: "2026-01-01T00:01:00Z" };

async function runCase(c: RunCaseInput): Promise<Record<string, unknown>> {
  const signer = c.signer ?? "approval-owner-1";
  const variant = c.variant ?? "standard";
  const signedBytes = utf8Encode(c.signedManifest ?? c.manifest);
  const digest = await sha256(signedBytes);
  const message = variant === "no_domain" ? digest : await runSigningMessage(signedBytes);
  let sig = await ed25519SignWithSeed(await seed(signer), message);
  if (variant === "noncanonical_s") sig = addL(sig);
  const fields = { key_id: c.keyId ?? "key_owner_1", manifest_sha256: toHex(digest), signature: toBase64Url(sig) };
  const approval = c.approvalOverride
    ? c.approvalOverride(fields)
    : JSON.stringify({ schema_version: "edgeops.approval.v1", ...fields });
  return {
    name: c.name,
    manifest_text: c.manifest,
    approval_text: approval,
    signer_seed_label: signer,
    signing_variant: variant,
    binding: { ...DEFAULT_BINDING, ...c.binding },
    expect: c.expect,
  };
}

export async function runApprovalVectors(): Promise<object> {
  const base = manifest();
  const cases: RunCaseInput[] = [
    { name: "valid", manifest: base, expect: { ok: true } },
    {
      name: "valid_exact_bytes_with_whitespace",
      manifest: JSON.stringify(JSON.parse(base), null, 2),
      expect: { ok: true },
    },
    {
      name: "parameter_changed_after_signing",
      manifest: manifest({ parameters: { unit: "other.service", lines: 50, follow: false } }),
      signedManifest: base,
      expect: { ok: false, code: "digest_mismatch", field: "manifest_sha256" },
    },
    {
      name: "reserialized_manifest_is_not_the_signed_bytes",
      manifest: JSON.stringify(JSON.parse(base), null, 2),
      signedManifest: base,
      expect: { ok: false, code: "digest_mismatch", field: "manifest_sha256" },
    },
    { name: "unpinned_key_id", manifest: base, keyId: "key_unknown", expect: { ok: false, code: "untrusted_key", field: "key_id" } },
    { name: "pinned_key_id_other_signer", manifest: base, signer: "attacker-1", expect: { ok: false, code: "bad_signature", field: "signature" } },
    { name: "signature_without_domain_separator", manifest: base, variant: "no_domain", expect: { ok: false, code: "bad_signature", field: "signature" } },
    { name: "non_canonical_signature_s", manifest: base, variant: "noncanonical_s", expect: { ok: false, code: "bad_signature", field: "signature" } },
    { name: "other_node", manifest: base, binding: { node_id: "node_other" }, expect: { ok: false, code: "node_mismatch", field: "node_id" } },
    { name: "other_generation", manifest: base, binding: { enrollment_generation: 2 }, expect: { ok: false, code: "generation_mismatch", field: "enrollment_generation" } },
    { name: "not_yet_valid", manifest: base, binding: { now: "2025-12-31T23:59:59Z" }, expect: { ok: false, code: "not_yet_valid", field: "not_before" } },
    { name: "expired_at_boundary", manifest: base, binding: { now: "2026-01-01T01:00:00Z" }, expect: { ok: false, code: "expired", field: "expires_at" } },
    {
      name: "duplicate_key_signed",
      manifest: base.replace('"timeout_seconds":30', '"timeout_seconds":30,"timeout_seconds":86400'),
      expect: { ok: false, code: "duplicate_key" },
    },
    { name: "unknown_privileged_field", manifest: manifest({ run_as: "root" }), expect: { ok: false, code: "unknown_field", field: "run_as" } },
    { name: "missing_field", manifest: manifest({}, ["policy_digest"]), expect: { ok: false, code: "missing_field", field: "policy_digest" } },
    { name: "unsupported_major", manifest: manifest({ schema_version: "edgeops.run.v2" }), expect: { ok: false, code: "unsupported_version", field: "schema_version" } },
    { name: "float_parameter", manifest: base.replace('"lines":50', '"lines":50.5'), expect: { ok: false, code: "non_integer_number" } },
    { name: "exponent_parameter", manifest: base.replace('"lines":50', '"lines":5e1'), expect: { ok: false, code: "non_integer_number" } },
    {
      name: "nested_parameter",
      manifest: manifest({ parameters: { unit: { name: "x" } } }),
      expect: { ok: false, code: "invalid_field", field: "parameters.unit" },
    },
    {
      name: "null_parameter",
      manifest: manifest({ parameters: { unit: null } }),
      expect: { ok: false, code: "invalid_field", field: "parameters.unit" },
    },
    {
      name: "parameter_name_injection",
      manifest: manifest({ parameters: { "unit;rm": "x" } }),
      expect: { ok: false, code: "invalid_field", field: "parameters.unit;rm" },
    },
    { name: "zero_timeout", manifest: manifest({ timeout_seconds: 0 }), expect: { ok: false, code: "invalid_field", field: "timeout_seconds" } },
    { name: "impossible_date", manifest: manifest({ not_before: "2026-02-30T00:00:00Z" }), expect: { ok: false, code: "invalid_field", field: "not_before" } },
    { name: "local_offset_time", manifest: manifest({ not_before: "2026-01-01T08:00:00+08:00" }), expect: { ok: false, code: "invalid_field", field: "not_before" } },
    {
      name: "window_longer_than_24h",
      manifest: manifest({ expires_at: "2026-01-02T00:00:01Z" }),
      expect: { ok: false, code: "invalid_field", field: "expires_at" },
    },
    { name: "unknown_profile", manifest: manifest({ execution_profile: "root" }), expect: { ok: false, code: "invalid_field", field: "execution_profile" } },
    { name: "uppercase_digest", manifest: manifest({ artifact_sha256: "A".repeat(64) }), expect: { ok: false, code: "invalid_field", field: "artifact_sha256" } },
    {
      name: "approval_duplicate_key",
      manifest: base,
      approvalOverride: (f) =>
        `{"schema_version":"edgeops.approval.v1","key_id":"${f.key_id}","key_id":"key_other","manifest_sha256":"${f.manifest_sha256}","signature":"${f.signature}"}`,
      expect: { ok: false, code: "duplicate_key" },
    },
    {
      name: "approval_padded_signature",
      manifest: base,
      approvalOverride: (f) =>
        JSON.stringify({ schema_version: "edgeops.approval.v1", key_id: f.key_id, manifest_sha256: f.manifest_sha256, signature: f.signature + "==" }),
      expect: { ok: false, code: "invalid_field", field: "signature" },
    },
  ];
  return {
    description: "RunManifest v1 approvals (SDD 05 §4). Test-only keys derived from public seed labels.",
    generated_by: "platform/edge-ops/backend/tools/vectors.ts",
    seed_derivation: `sha256(utf8("${SEED_PREFIX}" + label))`,
    signing_domain: "EDGEOPS-RUN-V1\\n",
    trusted_keys: { key_owner_1: await publicKey("approval-owner-1") },
    cases: await Promise.all(cases.map(runCase)),
  };
}

// ---------- request signatures ----------

interface ReqInput {
  name: string;
  method?: string;
  path?: string;
  query?: string;
  body?: string;
  purpose?: string;
  expectedPurpose?: string;
  sentAt?: string;
  now?: string;
  signer?: string;
  credentialId?: string;
  /** Mutations applied after signing. */
  tamper?: (r: { headers: Record<string, string>; body: string; path: string; query: string; method: string }) => void | Promise<void>;
  expect: { ok: true } | { ok: false; code: string; field?: string };
}

async function requestCase(c: ReqInput): Promise<Record<string, unknown>> {
  const method = c.method ?? "POST";
  const path = c.path ?? "/agent/v1/telemetry";
  const query = c.query ?? "";
  const body = c.body ?? '{"example":true}';
  const sentAt = c.sentAt ?? "2026-01-01T00:00:00Z";
  const fields = {
    purpose: c.purpose ?? "telemetry",
    credentialId: c.credentialId ?? "cred_test_telemetry",
    method,
    path,
    query,
    requestId: "req_0001",
    sentAt,
    nonce: "BBBBBBBBBBBBBBBBBBBBBB",
    bodySha256: toHex(await sha256(utf8Encode(body))),
  };
  const canonical = canonicalRequest(fields);
  const sig = await ed25519SignWithSeed(await seed(c.signer ?? "node-telemetry-1"), utf8Encode(canonical));
  const r = {
    method,
    path,
    query,
    body,
    headers: {
      [H.version]: "1",
      [H.purpose]: fields.purpose,
      [H.credential]: fields.credentialId,
      [H.requestId]: fields.requestId,
      [H.sentAt]: sentAt,
      [H.nonce]: fields.nonce,
      [H.contentSha256]: fields.bodySha256,
      [H.signature]: toBase64Url(sig),
    } as Record<string, string>,
  };
  await c.tamper?.(r);
  return {
    name: c.name,
    request: { method: r.method, path: r.path, query: r.query, headers: r.headers, body_text: r.body },
    expected_purpose: c.expectedPurpose ?? "telemetry",
    now: c.now ?? "2026-01-01T00:00:30Z",
    signer_seed_label: c.signer ?? "node-telemetry-1",
    canonical_text: canonical,
    expect: c.expect,
  };
}

export async function requestSigningVectors(): Promise<object> {
  const cases: ReqInput[] = [
    { name: "valid_post", expect: { ok: true } },
    { name: "valid_get_canonical_query", method: "GET", path: "/agent/v1/jobs/next", query: "a=1&b=x.y", body: "", purpose: "jobs", expectedPurpose: "jobs", signer: "node-courier-1", credentialId: "cred_test_courier", expect: { ok: true } },
    { name: "clock_skew_boundary_ok", now: "2026-01-01T00:02:00Z", expect: { ok: true } },
    { name: "clock_skew_exceeded", now: "2026-01-01T00:02:01Z", expect: { ok: false, code: "clock_skew", field: H.sentAt } },
    { name: "clock_skew_future", now: "2025-12-31T23:57:59Z", expect: { ok: false, code: "clock_skew", field: H.sentAt } },
    { name: "unsorted_query", method: "GET", path: "/agent/v1/jobs/next", query: "b=1&a=1", body: "", purpose: "jobs", expectedPurpose: "jobs", signer: "node-courier-1", credentialId: "cred_test_courier", expect: { ok: false, code: "non_canonical_query", field: "query" } },
    { name: "duplicate_query_key", method: "GET", path: "/agent/v1/jobs/next", query: "a=1&a=2", body: "", purpose: "jobs", expectedPurpose: "jobs", signer: "node-courier-1", credentialId: "cred_test_courier", expect: { ok: false, code: "non_canonical_query", field: "query" } },
    { name: "percent_encoded_path", path: "/agent/v1/tele%6Detry", expect: { ok: false, code: "non_canonical_path", field: "path" } },
    { name: "dot_segment_path", path: "/agent/v1/../api/v1/nodes", expect: { ok: false, code: "non_canonical_path", field: "path" } },
    { name: "trailing_slash_path", path: "/agent/v1/telemetry/", expect: { ok: false, code: "non_canonical_path", field: "path" } },
    { name: "body_tampered", tamper: (r) => void (r.body = '{"example":false}'), expect: { ok: false, code: "body_digest_mismatch", field: H.contentSha256 } },
    {
      name: "body_and_digest_tampered",
      tamper: async (r) => {
        r.body = '{"example":false}';
        r.headers[H.contentSha256] = toHex(await sha256(utf8Encode(r.body)));
      },
      expect: { ok: false, code: "bad_signature", field: H.signature },
    },
    { name: "path_changed_after_signing", tamper: (r) => void (r.path = "/agent/v1/log-chunks"), expect: { ok: false, code: "bad_signature", field: H.signature } },
    { name: "purpose_header_changed", expectedPurpose: "jobs", tamper: (r) => void (r.headers[H.purpose] = "jobs"), expect: { ok: false, code: "bad_signature", field: H.signature } },
    { name: "purpose_not_allowed_on_route", expectedPurpose: "jobs", expect: { ok: false, code: "purpose_mismatch", field: H.purpose } },
    { name: "unsupported_version", tamper: (r) => void (r.headers[H.version] = "2"), expect: { ok: false, code: "bad_version", field: H.version } },
    { name: "missing_nonce", tamper: (r) => void delete r.headers[H.nonce], expect: { ok: false, code: "missing_header", field: H.nonce } },
    { name: "malformed_request_id", tamper: (r) => void (r.headers[H.requestId] = "req_BAD ID"), expect: { ok: false, code: "invalid_header", field: H.requestId } },
    { name: "impossible_sent_at", tamper: (r) => void (r.headers[H.sentAt] = "2026-13-01T00:00:00Z"), expect: { ok: false, code: "invalid_header", field: H.sentAt } },
    { name: "unknown_credential", credentialId: "cred_unknown", expect: { ok: false, code: "unknown_credential", field: H.credential } },
    { name: "other_key", signer: "attacker-1", expect: { ok: false, code: "bad_signature", field: H.signature } },
    { name: "method_not_allowed", method: "PUT", expect: { ok: false, code: "method_not_allowed", field: "method" } },
  ];
  return {
    description: "edgeops-req-v1 machine request signatures (SDD 05 §2). Test-only keys.",
    generated_by: "platform/edge-ops/backend/tools/vectors.ts",
    seed_derivation: `sha256(utf8("${SEED_PREFIX}" + label))`,
    credentials: {
      cred_test_telemetry: await publicKey("node-telemetry-1"),
      cred_test_courier: await publicKey("node-courier-1"),
    },
    cases: await Promise.all(cases.map(requestCase)),
  };
}

// ---------- enrollment proofs ----------

export async function enrollVectors(): Promise<object> {
  const token = toBase64Url(await sha256(utf8Encode("edgeops-test-enrollment-token-1")));
  const otherToken = toBase64Url(await sha256(utf8Encode("edgeops-test-enrollment-token-2")));
  const make = async (o: { signer?: string; keyOf?: string; proofToken?: string; patch?: Record<string, unknown> }) => {
    const keyLabel = o.keyOf ?? "node-telemetry-1";
    const pub = await ed25519PublicFromSeed(await seed(keyLabel));
    const proof = await ed25519SignWithSeed(await seed(o.signer ?? keyLabel), await enrollSigningMessage(o.proofToken ?? token, pub));
    return JSON.stringify({
      schema_version: "edgeops.enroll.v1",
      enrollment_token: token,
      public_key: toBase64Url(pub),
      proof: toBase64Url(proof),
      agent_version: "0.1.0-dev",
      os: "linux",
      arch: "amd64",
      ...o.patch,
    });
  };
  const tokenHash = toHex(await sha256(utf8Encode(token)));
  return {
    description: "edgeops.enroll.v1 proof of key possession bound to one token (SDD 05 §2). Test-only keys and tokens.",
    generated_by: "platform/edge-ops/backend/tools/vectors.ts",
    seed_derivation: `sha256(utf8("${SEED_PREFIX}" + label))`,
    signing_domain: "EDGEOPS-ENROLL-V1\\n",
    cases: [
      { name: "valid", request_text: await make({}), expect: { ok: true, token_hash: tokenHash } },
      { name: "proof_by_other_key", request_text: await make({ signer: "attacker-1" }), expect: { ok: false, code: "bad_signature", field: "proof" } },
      { name: "proof_for_other_token", request_text: await make({ proofToken: otherToken }), expect: { ok: false, code: "bad_signature", field: "proof" } },
      { name: "unknown_field", request_text: await make({ patch: { hostname: "host.example.invalid" } }), expect: { ok: false, code: "unknown_field", field: "hostname" } },
      { name: "unsupported_arch", request_text: await make({ patch: { arch: "riscv64" } }), expect: { ok: false, code: "invalid_field", field: "arch" } },
      { name: "short_token", request_text: await make({ patch: { enrollment_token: "short" } }), expect: { ok: false, code: "invalid_field", field: "enrollment_token" } },
    ],
  };
}

export const GENERATED_VECTORS = {
  "run-approval.json": runApprovalVectors,
  "request-signing.json": requestSigningVectors,
  "enroll-proof.json": enrollVectors,
} as const;

export function render(doc: object): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
