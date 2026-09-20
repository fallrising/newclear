# ADR-0004: Provider Aliases and Availability Evidence

- Status: Accepted for local routing; exact runtime availability remains gated
- Date: 2026-09-02
- Owner: repository owner (`fallrising`)

## Context

The build requires multiple adapter routes, health checks, budgets, fallbacks, and
rate-limit handling. CLI listings and an authenticated smoke test are useful
local evidence, but they do not prove production automation entitlement,
contractual data rights, or stable provider identifiers.

## Decision

- Product policy refers only to stable role aliases, such as `builder`,
  `reviewer`, and `fallback`; aliases resolve through doctor-verified runtime
  configuration. No model ID, provider account, subscription, or endpoint is
  hard-coded as product policy.
- A route is eligible only after a doctor check records the configured alias,
  non-secret version/availability evidence, authentication mode, and bounded
  non-interactive smoke result. Evidence must be timestamped and rerunnable;
  credentials and raw auth material are never recorded.
- If an alias is unavailable, over budget, rate-limited, unauthorized for the
  data class, or times out, routing follows the approved fallback. If no safe
  fallback exists, fail closed and preserve the evidence. Do not silently swap
  providers or transmit restricted data.
- Local adapters may use synthetic fixtures and mocked/offline boundaries. This
  is local test evidence only and does not represent a real external gate as
  passed.

## External evidence gates

Exact provider/model identifiers for the configured aliases, CLI/API automation
terms and entitlement, non-interactive credential scopes, rate-limit/budget
behavior, and approved data-transmission matrix are `pending` for production.
The preflight doctor observations are not a substitute for those gates.

## Consequences

Provider changes are isolated to configuration and adapters. Deterministic tests
remain stable across model changes, while doctor evidence and policy validation
make availability changes visible instead of embedding them in application code.
