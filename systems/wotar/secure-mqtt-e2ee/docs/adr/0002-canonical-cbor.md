# ADR 0002: Canonical CBOR Wire Format

## Status

Accepted

## Context

Envelopes must be deterministic for test vectors, signature inputs, and AAD construction.
JSON with base64 encoding introduces ambiguity and parsing risks.

## Decision

Use canonical CBOR maps via `cbor2` canonical encoding. Binary fields as CBOR byte strings.
Protected header is a defined subset of map keys encoded canonically for AAD.

## Consequences

- Parser rejects duplicate semantic fields, unknown required types, and oversized payloads.
- No base64-JSON wire format.