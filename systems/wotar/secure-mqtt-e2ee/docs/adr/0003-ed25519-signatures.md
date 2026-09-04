# ADR 0003: Ed25519 Publisher Signatures

## Status

Accepted

## Context

Brokers can modify metadata and relay messages. Sender authenticity must not rely on
broker-assigned identity or self-asserted public keys in the envelope.

## Decision

Every message carries a 64-byte Ed25519 signature over a domain-separated input including
AAD, nonce, and ciphertext. Public keys are resolved from a trusted registry by `sig_kid`.

## Consequences

- Envelope must not contain sender public key.
- Unknown or revoked signing keys fail closed.