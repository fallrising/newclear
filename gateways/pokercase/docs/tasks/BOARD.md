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

## T-1102 — LLM 用量正確性修正文件先行

需求來源：owner 於 2026-10-24 直接要求將 Langfuse 比較後續拆成開發與修正兩個文件 PR。
承接者：Codex 主導；範圍限本文件里程碑。規格路徑：[修正規格](../../../../docs/specs/llm-usage-correctness.md)。
初次交付為文件 Draft PR；owner 於 2026-10-24 另行授權合併。本節只關閉文件里程碑，runtime 實作、真帳號驗收與部署仍未完成；既有產品驗收狀態不變。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| UC-D01 | 以固定來源分類已確認缺陷、待重現問題與實機驗收缺口 | UC-D01 | done | 2026-10-24T14:17:37Z | 2026-10-24T15:50:53Z | 2026-10-24T15:51:14Z |
| UC-D02 | 定義串流計量、缺值彙總與相關修正的重現及驗收矩陣 | UC-D02 | done | 2026-10-24T14:17:37Z | 2026-10-24T15:50:53Z | 2026-10-24T15:51:14Z |
| UC-D03 | 定義修正順序、相容性、獨立審查與後續交接 | UC-D03 | done | 2026-10-24T14:17:37Z | 2026-10-24T15:50:53Z | 2026-10-24T15:51:14Z |

文件內容與本地檢查已通過；獨立 agent 文件審查 ACCEPT，命令與結果見 [T-1102 文件驗收](../../SUCCESS.md#t-1102--llm-用量正確性修正文件先行)。
文件里程碑已於原文件 PR 合併後結案；`end` 記實際合併時間，後續 runtime AC 與來源驗收缺口仍保留。

合併證據：[PR #609](https://github.com/fallrising/newclear/pull/609)，`2026-10-24T15:50:53Z`，merge SHA `23f2b7f2435f5f805d95c84ec3d112363867108f`；已從 GitHub 回讀 `merged=true`。
已驗證文件 head：`d7838fe3358e32ca7e78bd95cd60f75a29b61303`；獨立文件審查 ACCEPT。
該 head 的必要 CI 全部通過：[Pokercase CI](https://github.com/fallrising/newclear/actions/runs/40107039186)、[Project success contracts](https://github.com/fallrising/newclear/actions/runs/40107039191)；文件及 CI 通過不代表後續功能已實作。

## T-0403 — Direct JSON Responses

Demand/contract: [task](T-0403-json-responses.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| JR-01 | Reject failed or malformed direct JSON envelopes | JR-1 | done | 2026-10-24T16:03:44Z | 2026-10-24T16:11:59Z | 2026-10-24T16:11:59Z |
| JR-02 | Preserve completed/incomplete bodies and conversions | JR-2 | done | 2026-10-24T16:03:44Z | 2026-10-24T16:11:59Z | 2026-10-24T16:11:59Z |
| JR-03 | Preserve explicit native background pending replies | JR-3 | done | 2026-10-24T16:03:44Z | 2026-10-24T16:11:59Z | 2026-10-24T16:11:59Z |

JR-1–JR-3 delivered in [PR #614](https://github.com/fallrising/newclear/pull/614), merge `e7262bd5d131ac174651cc4ab4c7e1c024aac27c` at `2026-10-24T16:11:59Z`. Independent source review PASS; required component CI106s and project-contract CI6s passed. Fetched main contains the reviewed HEAD and scoped component contents match. This records the publication result following the source task evidence; whole-product and real-provider acceptance remain incomplete.

## T-0404 — Client disconnect

Demand/contract: [task](T-0404-disconnect.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| DC-01 | Cancel silent active Claude turns on client disconnect | DC-1 | done | 2026-10-24T16:28:52Z | 2026-10-24T16:42:18Z | 2026-10-24T16:42:18Z |
| DC-02 | Preserve completed session reuse and track renewed sinks | DC-2 | done | 2026-10-24T16:28:52Z | 2026-10-24T16:42:18Z | 2026-10-24T16:42:18Z |
| DC-03 | Verify HTTP and fake Cursor release | DC-3 | done | 2026-10-24T16:28:52Z | 2026-10-24T16:42:18Z | 2026-10-24T16:42:18Z |

DC-1–DC-3 delivered in [PR #617](https://github.com/fallrising/newclear/pull/617), merge `2b64971c0bc209a67f9e37e76785b7009f746847` at `2026-10-24T16:42:18Z`. Independent source review PASS; required component CI109s and project-contract CI9s passed. Fetched main contains reviewed HEAD `a2b3bfb9e0bbe333f4507caa9e70d8bd1802e8fe` and scoped component contents match. Evidence covers134Linux tests and44local disconnect scenarios; actual Docker/provider cancellation and whole-product acceptance remain unverified.

## T-0405 — SSE stall

Demand/contract: [task](T-0405-sse-stall.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Return protocol failures for stalled converted/native SSE | ST-1 | done | 2026-10-24T17:02:57Z | 2026-10-24T17:13:51Z | 2026-10-24T17:13:51Z |
| ST-02 | Release upstream before failure delivery, preserve idle policy | ST-2 | done | 2026-10-24T17:02:57Z | 2026-10-24T17:13:51Z | 2026-10-24T17:13:51Z |
| ST-03 | Preserve known terminals and verify HTTP wiring | ST-3 | done | 2026-10-24T17:02:57Z | 2026-10-24T17:13:51Z | 2026-10-24T17:13:51Z |

ST-1–ST-3 delivered in [PR #619](https://github.com/fallrising/newclear/pull/619), merge `08e97cb6748d64853464f415cab6931b289af30b` at `2026-10-24T17:13:51Z`. Reviewed HEAD `984fa3c92f43ac58c9da3f459cf66e414550a1af` is an ancestor of fetched main; scoped component contents match. Independent source review PASS;138tests/77new scenarios and required component CI129s/project-contract CI9s passed. Opaque passthrough remains a transport failure; real-provider/Docker and whole-product acceptance remain incomplete.

## T-0407 — SSE read errors

Demand/contract: [task](T-0407-sse-io.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| IO-01 | Report fixed protocol errors without source diagnostics | IO-1 | done | 2026-10-24T17:43:24Z | 2026-10-24T17:51:19Z | 2026-10-24T17:51:19Z |
| IO-02 | Release source/error before final output | IO-2 | done | 2026-10-24T17:43:24Z | 2026-10-24T17:51:19Z | 2026-10-24T17:51:19Z |
| IO-03 | Preserve known terminals and verify broken HTTP streams | IO-3 | done | 2026-10-24T17:43:24Z | 2026-10-24T17:51:19Z | 2026-10-24T17:51:19Z |

IO-1–IO-3 delivered in [PR #623](https://github.com/fallrising/newclear/pull/623), merge `d7c7a24c580c20d0f8de3b83a4b649804af46e9a` at `2026-10-24T17:51:19Z`. Reviewed HEAD `7cabfc781e1543667d1116b7067686d0c53120c2` is an ancestor of fetched main; scoped component contents match. Independent source/final-doc review PASS;143tests/96new scenarios and required component CI131s/project-contract CI8s passed. Generated transport diagnostics are redacted; forwarded payloads remain unchanged. Provider/Docker and whole-product acceptance remain incomplete.

## T-0408 — Terminal release

Demand/contract: [task](T-0408-terminal-release.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| TR-01 | Release recognized terminal sources before final frame | TR-1 | done | 2026-10-24T19:39:38Z | 2026-10-24T19:46:58Z | 2026-10-24T19:46:58Z |
| TR-02 | Release observed EOF sources before finalization output | TR-2 | done | 2026-10-24T19:39:38Z | 2026-10-24T19:46:58Z | 2026-10-24T19:46:58Z |
| TR-03 | Preserve usage tails and session reuse; verify HTTP close | TR-3 | done | 2026-10-24T19:39:38Z | 2026-10-24T19:46:58Z | 2026-10-24T19:46:58Z |

TR-1–TR-3 delivered in [PR #625](https://github.com/fallrising/newclear/pull/625), merge `343ecae1f90d2bbcd4d8bd7a3a9eee6565c66882` at `2026-10-24T19:46:58Z`. Reviewed HEAD `e89c7bbebbd1d0ca7b66440594f4d5660735d172` is an ancestor of fetched main; scoped contents match. Independent source/final-document review PASS;148tests/85new scenarios and required component CI112s/contracts CI8s passed. Opaque byte behavior, finish_reason usage tails and reusable Claude sessions remain intact. Provider/Docker and whole-product acceptance remain incomplete.
