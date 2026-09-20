# ADR-0003: Credentials, Data Rights, and Synthetic Fixtures

- Status: Accepted for Phase 0–1; production data use blocked by explicit gates
- Date: 2026-09-02
- Owner: repository owner (`fallrising`)

## Context

Repository content, issues, PDFs, images, web pages, and tool output are
untrusted input. Private repository visibility does not establish permission to
send third-party or personal data to a provider. The preflight record confirms
that no rights-cleared private corpus or production credentials were supplied.

## Decision

- Local end-to-end tests use synthetic, rights-cleared, non-sensitive text PDFs,
  scanned PDFs, and knowledge notes only. Fixtures retain source hash, page/chunk
  provenance, extractor/OCR identity, and confidence where applicable.
- Classify data before adapter invocation. Confidential, restricted, personal,
  credential-bearing, or rights-unclear input is rejected before transmission;
  synthetic fixtures do not stand in for authorization or real-data acceptance.
- Inject credentials only through the runtime secret mechanism at the narrowest
  adapter/job boundary. Never commit, log, cache, serialize, or place credentials
  in prompts. Secret scanning remains a gate; detected secrets stop the job and
  trigger redaction/rotation procedures.
- Apply least privilege by role: builders get provider access only as required,
  reviewers receive diff/report inputs, and publishers receive only scoped GitHub
  write access. Coding agents do not receive production secrets.
- A source takedown/redaction request must remove or quarantine the source through
  an auditable, idempotent operation and invalidate derived outputs as required.

## External evidence gates

Human confirmation of data rights/contractual permission for each real corpus,
approved provider transmission matrix, production secret-injection mechanism,
secret rotation/revocation test, and takedown/redaction runbook evidence are
`pending`. Until those gates pass, only local synthetic data may be used and the
system must not claim production readiness.

## Consequences

Local tests can exercise provenance, privacy, and rejection behavior without
exposing real data. Real corpus onboarding is a separate human-approved change;
provider calls fail closed when classification or rights are unknown.
