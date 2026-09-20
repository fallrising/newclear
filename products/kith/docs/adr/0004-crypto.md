# ADR-0004 — Optional application-layer AES-GCM; not E2EE

- Status: accepted
- Date: 2026-09-20
- Applies to: kith M7 optional keyring (`src/keyring.ts`); does not change M0–M6 persist

## Context

kith stores room history in D1. Cloudflare encrypts platform storage at rest. That is **not** end-to-end encryption (not E2EE): anyone who can run the Worker with the instance secrets can read plaintext after authorization.

[DESIGN.md](../../DESIGN.md) already chose an honest server-side model and made application-layer AES-GCM an **M7 optional** path that must not block M1–M6. Copying EdgeChat's keyring is forbidden (GPL). Claiming D1 at-rest as E2EE is forbidden.

DESIGN 誠實聲明（必須保留，不可改寫成端對端）：

> 這是服務端加密（可選），**不是**端對端加密。Worker 在授權後可解密。Cloudflare 執行環境與持有 key 的 operator 都必須被信任。管理介面沒有「偷看聊天」按鈕，不代表技術上無法讀取。

## Decision

- Provide an **optional** application-layer AES-GCM keyring (256-bit, WebCrypto `generateKey` / `importKey`, UTF-8 encrypt → `{iv, ciphertext}` base64url).
- **Default off.** `isEnabled(envFlag)` is false unless the flag is the exact string `"on"`.
- After authorization, the **Worker can decrypt**. This is server-side encryption, **不是**端對端加密 (not E2EE).
- Cloudflare D1/R2/KV at-rest encryption is a platform control. It is **not E2EE** and must not be documented as such.
- When the keyring is enabled, logs **must not** contain plaintext (body, token, prompt, decrypted message text).
- Do **not** wire encrypt into Room persist by default. Enabling persist encryption is a later, explicit change.
- Do **not** copy EdgeChat crypto source.

## Consequences

- Core product remains TLS in transit + Cloudflare at-rest. Optional AES-GCM is extra wrapping, still readable by the Worker.
- Operators who set the flag must keep the 256-bit key as a secret; losing it loses ciphertext.
- Tests cover roundtrip, empty plaintext, and wrong-key failure (`M7-CRYPTO-01`). Live smoke is not a core gate.
- M7 remains optional; GC/metrics/keyring are not M0–M6 completion criteria.

## Rejected alternatives

- Marketing Cloudflare at-rest as E2EE.
- Client-held E2EE as a v0.1 product claim (DESIGN non-goal).
- Default-on encryption, or logging plaintext when enabled.
- Forking EdgeChat keyring code.
