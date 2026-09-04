# Residual Risks

This document records known limitations after local development and integration validation.
**Self-managed keys provide application-layer confidentiality**, but operational controls
still matter (keyring custody, broker ACLs, endpoint hardening).

## Cryptographic and Protocol

| Risk | Severity | Mitigation Status |
|------|----------|-------------------|
| No forward secrecy for previously distributed group DEKs | Medium | Documented non-goal; requires per-message key agreement redesign |
| Topic/metadata visible to broker and network observers | Medium | Documented non-goal |
| Application schema validation is JSON-parse only | Low | Pluggable validators not implemented |

## Key Management

| Risk | Severity | Mitigation Status |
|------|----------|-------------------|
| `FileKeyringProvider` stores key material on disk | High | Accepted model: operator-owned keyring; POSIX 0600/0700 enforced; endpoint compromise exposes keys |
| Keyring distribution is out-of-band | Medium | Documented in `self-managed-key-design.md`; optional operator-side encryption before remote backup |
| Signing key validity depends on registry distribution | Medium | `not_before`/`not_after` enforced against signed issuance time; stale registries remain an operational risk |

## Broker and Network

| Risk | Severity | Mitigation Status |
|------|----------|-------------------|
| Malicious broker can drop/delay messages | Medium | Documented non-goal; outbox retries help publish side only |
| Local EMQX ACL is file-based dev config | Medium | Integration-tested; not equivalent to production ACL review |
| Public EMQX profile allows anonymous TLS | High | Synthetic data only; `public-dev` + opt-in smoke; `production` rejects `broker.emqx.io` |

## Operational

| Risk | Severity | Mitigation Status |
|------|----------|-------------------|
| Full package test coverage below 90% | Low | Core crypto/protocol/persistence gated at 86%+ |
| No centralized secret scanning in CI | Low | Manual `pip-audit` documented in Makefile |
| Handler exactly-once not guaranteed | Medium | Inbox dedup gives at-most-once per `(sender_id, msg_id)` |

## Endpoint Compromise

Compromised endpoint exposes local keyring, signing seed, and plaintext handlers.
This is an explicit threat-model non-goal for the self-managed key model.
