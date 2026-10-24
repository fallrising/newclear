# Pokercase 技術任務

## T-0377 — Cursor 外部隔離

需求：[desk T-0377](https://github.com/fallrising/desk/tree/main/tasks/T-0377-thinrouter-cursor-isolation)。規格：[cursor-isolation](../cursor-isolation.md)。

| ID | 任務 | AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CUR-01 | 外部容器 runner、回歸與 canary | CI-1–CI-5 | done | 2026-10-23T16:57:52Z | 2026-10-23T18:01:20Z | 2026-10-23T18:05:45Z |
| CUR-02 | [專用profile登入與一次真實文字驗收](../cursor-live-smoke.md)；登入成功；重試確認sandbox不可用，已補固定503診斷；修正後單次gateway驗收HTTP200與清理通過，證據PR #580已合併 | AC-17（單次文字） | done | 2026-10-23T18:13:50Z | 2026-10-24T06:19:49Z | 2026-10-24T06:19:49Z |

原 Claude session 的其餘未驗證產品旅程仍保留 SUCCESS.md，不納入此隔離切片的完成聲明。

CUR-01 已由 [PR #566](https://github.com/fallrising/newclear/pull/566) 合併為 `cbf1021f4d67ff60683dbfdb47e7bd75101e07bd`，本機完整測試、Docker canary、獨立審查及必要 CI 均通過。此狀態只表示 CI-1–CI-5 隔離切片完成，整體產品及真帳號旅程仍依 SUCCESS.md 待驗收。

## T-0385 — Cursor terminal errors

Demand and CE-1–CE-3: [task record](T-0385-cursor-errors.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CE-01 | Reject failed terminal results and verify protocol errors | CE-1–CE-3 | done | 2026-10-24T07:35:00Z | 2026-10-24T07:44:30Z | 2026-10-24T07:44:30Z |

## T-0386 — Converted stream completion

Demand and SC-1–SC-3: [task](T-0386-stream-completion.md). End records local implementation/review completion; publication recorded separately in desk/journal.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| SC-01 | Reject premature converted-stream EOF; preserve explicit completion | SC-1–SC-3 | done | 2026-10-24T10:36:00Z | 2026-10-24T10:45:00Z | 2026-10-24T10:45:00Z |

## T-0389 — Buffered Responses completion

Demand/BR-1–BR-3: [task](T-0389-buffered-responses.md). End means localimplementation/review complete; remotepublication tracked separately.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| BR-01 | Validate buffered Responses terminal evidence across three APIs | BR-1–BR-3 | done | 2026-10-24T11:08:00Z | 2026-10-24T11:22:00Z | 2026-10-24T11:22:00Z |

## T-0401 — Native Responses completion

Demand and contract: [task](T-0401-native-responses.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| NR-01 | Reject missing or invalid native terminal | NR-1 | done | 2026-10-24T11:42:47Z | 2026-10-24T11:53:33Z | 2026-10-24T11:53:33Z |
| NR-02 | Preserve accepted frames and first-terminal finality | NR-2 | done | 2026-10-24T11:42:47Z | 2026-10-24T11:53:33Z | 2026-10-24T11:53:33Z |
| NR-03 | Bound and verify SSE framing | NR-3 | done | 2026-10-24T11:42:47Z | 2026-10-24T11:53:33Z | 2026-10-24T11:53:33Z |

NR-1–NR-3 merged in [PR #601](https://github.com/fallrising/newclear/pull/601) at `2026-10-24T11:53:33Z` as `0e99542ec10213524bacffed73699556edfebb8e`. Required CI (component 111s, project contracts 8s) and independent review passed; fetched main contains the reviewed HEAD and the component matches it. SUCCESS/task local verification entries were written before publication; this board records the subsequent publication result. Whole-product acceptance remains incomplete.

## T-0380 FE round2

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FE2-12 | Approved M1–M4 presentation and isolated evidence | R2-AC-12/E | done | 2026-10-24T12:21:48Z | 2026-10-24T14:18:11Z | 2026-10-24T14:18:11Z |

Pokercase original Round2 M1–M4 delivered in [PR603](https://github.com/fallrising/newclear/pull/603), merge `05aeed43a3a49cc1b4a98f760e52fa2881c61064` at 2026-10-24T14:18:11Z. R31 ACCEPT, both current CI checks SUCCESS and fetched scoped equality passed. This is scoped delivery; full Round3 and gateway mainline/owner acceptance remain separate.
