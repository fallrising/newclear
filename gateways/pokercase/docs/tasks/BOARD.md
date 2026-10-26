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

## T-0410 — Converted input bound

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| IB-1 | Bound converted input lines and fail/release on excess | IB-1 | done | 2026-10-25T06:44:00Z | 2026-10-25T06:53:35Z | 2026-10-25T06:53:35Z |
| IB-2 | Preserve boundary, framing and terminal compatibility | IB-2 | done | 2026-10-25T06:44:00Z | 2026-10-25T06:53:35Z | 2026-10-25T06:53:35Z |
| IB-3 | HTTP evidence, native gates and independent review | IB-3 | done | 2026-10-25T06:44:00Z | 2026-10-25T06:53:35Z | 2026-10-25T06:53:35Z |

[Contract](../../SUCCESS.md#t-0410--converted-input-bound) · [Task](T-0410-input-bound.md).

Delivered in [PR627](https://github.com/fallrising/newclear/pull/627), source `a383cc529aa5280508e1effc2c35c530ff93bb23`, merge `18993aa6abc7d968e55f8c2f0c567fef84e06c05` at `2026-10-25T06:53:35Z`. Necessary component/contracts CI passed161s/9s; remote ancestry and component readback PASS.154tests/15groups,125newscenarios;fmt/clippy/docs/index and independent source/final-document review PASS. Exact evidence/limits in the task record; no real-provider/Docker or whole-product acceptance.

## T-0411 — Retained converter state

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| RS-1 | Bound retained output text, tools and metadata | RS-1 | done | 2026-10-25T09:36:16Z | 2026-10-25T09:50:07Z | 2026-10-25T09:50:07Z |
| RS-2 | Bound tool maps and argument aliases | RS-2 | done | 2026-10-25T09:36:16Z | 2026-10-25T09:50:07Z | 2026-10-25T09:50:07Z |
| RS-3 | Chain failure, source release and HTTP verification | RS-3 | done | 2026-10-25T09:36:16Z | 2026-10-25T09:50:07Z | 2026-10-25T09:50:07Z |

[Contract](../../SUCCESS.md#t-0411--retained-converter-state) · [Task](T-0411-state-bound.md).

Delivered in [PR632](https://github.com/fallrising/newclear/pull/632), source `0bf108a9ca0f6a3adcf514c7944baef4b5168f4a`, merge `9470b0597503e348c25e482928904eb10e72c35e` at `2026-10-25T09:50:07Z`. Necessary component/contracts CI passed171s/10s; remote ancestry and scoped component readback PASS.165tests/16groups,43newscenarios;fmt/clippy/docs/index and independent source/final-document review PASS. See task for logical-budget and chain ownership limits; no total-RSS, real-provider/Docker or whole-product acceptance.


## T-0412 — Bounded response collection

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| BC-1 | Bound HTTP successful bodies | BC-1 | done | 2026-10-25T10:10:25Z | 2026-10-25T10:20:37Z | 2026-10-25T10:20:37Z |
| BC-2 | Bound shared CLI records | BC-2 | done | 2026-10-25T10:10:25Z | 2026-10-25T10:20:37Z | 2026-10-25T10:20:37Z |
| BC-3 | Compatibility and release evidence | BC-3 | done | 2026-10-25T10:10:25Z | 2026-10-25T10:20:37Z | 2026-10-25T10:20:37Z |

[Contract](../../SUCCESS.md#t-0412--bounded-response-collection) · [Task](T-0412-collect-bound.md).

Delivered in [PR635](https://github.com/fallrising/newclear/pull/635), source `2f3c1a9292270d02b744c20cf090aa89a66e6387`, merge `5bf5430fbd415da70ba7768c3291b2d680e2fe44` at `2026-10-25T10:20:37Z`. Necessary component/contracts CI passed; exact checks are linked in PR635. Remote source ancestry and scoped component readback PASS.172tests/17groups,54newscenarios/7tests;fmt/clippy/docs/index and independent source/final-document review PASS. See task for retained-input boundaries and exclusions; no total-RSS or real-provider/Docker acceptance.


## T-0413 — Bounded HTTP diagnostics

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| DG-1 | Bound and release diagnostic input | DG-1 | done | 2026-10-25T11:45:34Z | 2026-10-25T11:58:44Z | 2026-10-25T11:58:44Z |
| DG-2 | Preserve forwarding recovery and cancellation | DG-2 | done | 2026-10-25T11:45:34Z | 2026-10-25T11:58:44Z | 2026-10-25T11:58:44Z |
| DG-3 | Bound token errors and verify compatibility | DG-3 | done | 2026-10-25T11:45:34Z | 2026-10-25T11:58:44Z | 2026-10-25T11:58:44Z |

[Contract](../../SUCCESS.md#t-0413--bounded-http-diagnostics) · [Task](T-0413-diagnostic-bound.md).

Delivered in [PR637](https://github.com/fallrising/newclear/pull/637), source `47f473e9d6f808f33d8e2ea3b96ea20e542b3e43`, merge `388e33e9cf0f6cb63d9b795247ff182295696510` at `2026-10-25T11:58:44Z`. Required component/contracts CI and independent source/final-document review PASS; remote ancestry and scoped component readback PASS.177tests/18groups,285newscenarios/5tests;fmt/clippy/43contracts/6llms PASS. Original RED, fixture-path and initial lint failures retained with passing corrections. See task for raw-input limits, within-bound diagnostic content and token-success exclusions; no live-provider/RSS acceptance.


## T-0414 — Successful token response bounds

[Contract](../../SUCCESS.md#t-0414--bounded-successful-token-responses) · [Evidence](T-0414-token-bound.md)

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| TK-1 | Bound successful token collection and preserve refresh semantics | TK-1 | done | 2026-10-25T12:17:19Z | 2026-10-25T12:29:59Z | 2026-10-25T12:29:59Z |
| TK-2 | Bound successful token collection and preserve refresh semantics | TK-2 | done | 2026-10-25T12:17:19Z | 2026-10-25T12:29:59Z | 2026-10-25T12:29:59Z |
| TK-3 | Bound successful token collection and preserve refresh semantics | TK-3 | done | 2026-10-25T12:17:19Z | 2026-10-25T12:29:59Z | 2026-10-25T12:29:59Z |

Delivered in [PR639](https://github.com/fallrising/newclear/pull/639), source `6203c6e5206fe77e31fcc5bc38f340bfc4dd9660`, merge `08e40f797c6d9979eb36531ae51c704a15c1373e` at `2026-10-25T12:29:59Z`. Required component/contractsCI and independent source/final-document review PASS;remote ancestry and scoped content readback PASS.183tests/18groups,48newscenario iterations/6tests;fmt/clippy/43contracts/6indexes PASS. Original RED and corrected setup/compile/read-fixture failures retained. See task for exact helper/HTTP/store evidence and remote rotation limits;no liveprovider/RSS acceptance.


## T-0415 — Bounded CLI stdout records

[Contract](../../SUCCESS.md#t-0415--bounded-cli-stdout-records) · [Evidence](T-0415-cli-line-bound.md)

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| LB-1 | Bound CLI stdout records and release failed runs | LB-1 | done | 2026-10-25T12:50:07Z | 2026-10-25T13:07:20Z | 2026-10-25T13:07:20Z |
| LB-2 | Bound CLI stdout records and release failed runs | LB-2 | done | 2026-10-25T12:50:07Z | 2026-10-25T13:07:20Z | 2026-10-25T13:07:20Z |
| LB-3 | Bound CLI stdout records and release failed runs | LB-3 | done | 2026-10-25T12:50:07Z | 2026-10-25T13:07:20Z | 2026-10-25T13:07:20Z |

Delivered in [PR642](https://github.com/fallrising/newclear/pull/642),source`12e0dcda85cb0ce44a9caa30d0b4504f926b5d5f`,merge`1aed62a92dad203fedc4cb8735fd7c3b9440dabd` at`2026-10-25T13:07:20Z`. Required component/contractsCI and independent source/finaldoc reviewPASS;remote ancestry/scopedcontentPASS.189tests/18groups,75newscenarios/6tests,fmt/clippy/43contracts/6indexesPASS. Original no-newlineRED retained.39fakeCLI/runtime process cases and36reader scenarios;no realDocker/provider/RSS acceptance.


## T-0416 — Claude stderr drain

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| SD-1 | Drain stderr before input and throughout reusable turns | SD-1 | done | 2026-10-25T15:35:36Z | 2026-10-25T15:47:12Z | 2026-10-25T15:47:12Z |
| SD-2 | Bound diagnostic retention and preserve error precedence | SD-2 | done | 2026-10-25T15:35:36Z | 2026-10-25T15:47:12Z | 2026-10-25T15:47:12Z |
| SD-3 | Own drain cancellation, pipe release and process lifecycle | SD-3 | done | 2026-10-25T15:35:36Z | 2026-10-25T15:47:12Z | 2026-10-25T15:47:12Z |

Delivered in [PR644](https://github.com/fallrising/newclear/pull/644), source `b5a851fd964868a451c779b6f2b0e8534cf2fcdb`, merge `c6e255ec16659e0654552faea1696e7a68f91bf0`. SD-1–SD-3: 196 tests / 18 groups, 27 new scenarios / 7 tests, fmt/clippy, contracts/index and independent review passed. Required CI and remote readback passed; live-provider and whole-product acceptance remain separate.


## T-0417 — Claude event state bounds

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CF-1 | Bound retained event payload and block starts before mutation | CF-1 | done | 2026-10-25T16:03:04Z | 2026-10-25T16:14:22Z | 2026-10-25T16:14:22Z |
| CF-2 | Preserve exact limits, tool mapping and message reset | CF-2 | done | 2026-10-25T16:03:04Z | 2026-10-25T16:14:22Z | 2026-10-25T16:14:22Z |
| CF-3 | Release abnormal runs and preserve healthy sessions | CF-3 | done | 2026-10-25T16:03:04Z | 2026-10-25T16:14:22Z | 2026-10-25T16:14:22Z |

Delivered in [PR646](https://github.com/fallrising/newclear/pull/646), source `4c9bb202f62f4a08cdbf4d273bde25d3e403923c`, merge `cd124339caa71c7f1d5f86cabdd765f36761f6e7`. CF-1–CF-3: 203 tests / 18 groups, 48 new scenarios / 7 tests, fmt/clippy, contracts/index, independent review and required CI passed. Remote content readback passed; live-provider and whole-product acceptance remain separate.


## T-0418 — Claude startup directory cleanup

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| SC-1 | Own run directory across setup and startup failures | SC-1 | done | 2026-10-25T16:30:59Z | 2026-10-25T16:43:21Z | 2026-10-25T17:46:53Z |
| SC-2 | Clean a dropped startup future | SC-2 | done | 2026-10-25T16:30:59Z | 2026-10-25T16:43:21Z | 2026-10-25T17:46:53Z |
| SC-3 | Preserve live tool files and remove at run end | SC-3 | done | 2026-10-25T16:30:59Z | 2026-10-25T17:46:53Z | 2026-10-25T17:46:53Z |

Startup ownership guard: [PR650](https://github.com/fallrising/newclear/pull/650), source `e8abdd089caaa03b93bf33d9be03e39d0b616e38`, merge `c19f5ebe56502634990e8d9266e0ea395eda732e`. Its 208 tests / 18 groups and required CI passed, but original [PR651 CI](https://github.com/fallrising/newclear/actions/runs/40213245378) subsequently failed the SC-3 final-result HTTP request at 20 seconds. That failure and the diagnostic-only [PR652](https://github.com/fallrising/newclear/pull/652) remain historical evidence.

Continuation repair: [PR654](https://github.com/fallrising/newclear/pull/654), source `3144debf49b6462035ad9a080ba09bd64cc2edef`, merge `b7c268adf3c631ea82ff306ca86af91ff589cc30` at 2026-10-25T17:46:53Z. Controlled callback-before-stdout ordering reproduced callback rejection, unsolicited completion and stale tool waiting state; the same ordering now completes without changing client20s/idle2s/cleanup3s thresholds. One shared idle deadline covers announcement/result waits; atomic waiter registration and turn/sink handoff prevent lost delivery; completion clears stale state even without a sink. Late results use the existing fallback. Numeric run ID and fixed lifecycle stages provide opt-in tracing without auth/session/body/tool content.

Final local validation: 214 tests / 18 groups, six new tests / nine controlled scenarios, fmt/Clippy, 43 contracts / six indexes and independent source/final-document review passed. PR654 required CI and fetched source ancestry/scoped content/trailer readback passed. Original PR651 is refreshed through a normal merge of origin/main and must pass fresh CI before board publication. The original CI schedule was not observed internally; the deterministic reproduction establishes a causal defect matching its symptom.

Future-drop coverage remains direct abort/join; blocked-stdin HTTP disconnect is not claimed fixed. No live provider/model/login, dependency/permission, release/deploy or whole-product acceptance. Owner decides desk done. [Task and detailed evidence](T-0418-claude-startup.md).


## T-0419 — Claude startup input cancellation

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| IC-1 | Reject pre-cancelled admission without side effects | IC-1 | done | 2026-10-25T18:01:29Z | 2026-10-25T18:15:43Z | 2026-10-25T18:15:43Z |
| IC-2 | Cancel blocked initial input and release resources | IC-2 | done | 2026-10-25T18:01:29Z | 2026-10-25T18:15:43Z | 2026-10-25T18:15:43Z |
| IC-3 | Preserve healthy startup and existing error behavior | IC-3 | done | 2026-10-25T18:01:29Z | 2026-10-25T18:15:43Z | 2026-10-25T18:15:43Z |

[Task and acceptance](T-0419-claude-input-cancel.md). Explicit initial-input token cancellation only; HTTP disconnect detection and idle-resume writes remain outside scope.

Delivered in [PR656](https://github.com/fallrising/newclear/pull/656), source `36aced67caaa172a24294f0f4374f9e0c05f7a53`, merge `13e9dfeb12d966cc3f2ace9b2030bec588ba128a` at 2026-10-25T18:15:43Z. IC-1–IC-3:218tests/18groups,4newtests/7scenarios,fmt/Clippy,43contracts/six indexes,independent source/final-document review and requiredCI passed. Source/merge ancestry, trailers and scoped remote content readback passed. Explicit token cancellation ends blocked initial input using existing stop/reap/drain before499/non-retryable; pre-cancelled requests preserve capacity and reusable state. Original RED7.04s and two fixture corrections retained. HTTP-disconnect detection and idle-resume input cancellation are not claimed. No live provider/model/login or whole-product acceptance; owner decides desk done.


## T-0420 — Claude resumed input cancellation

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| RI-1 | Cancel resumed stdin acquisition/write without replay | RI-1 | done | 2026-10-26T07:02:16Z | 2026-10-26T07:24:14Z | 2026-10-26T07:24:14Z |
| RI-2 | Retire interrupted runs and release resources | RI-2 | done | 2026-10-26T07:02:16Z | 2026-10-26T07:24:14Z | 2026-10-26T07:24:14Z |
| RI-3 | Preserve healthy continuation and ordinary-error fallback | RI-3 | done | 2026-10-26T07:02:16Z | 2026-10-26T07:24:14Z | 2026-10-26T07:24:14Z |

[Task and acceptance](T-0420-claude-resume-cancel.md). Explicit resumed-input cancellation only; no HTTP-disconnect or general response-wait claim.

Delivered in [Product PR660](https://github.com/fallrising/newclear/pull/660), source `9d9948374846dea442685c65769314cca130ead2`, merge `ea6962db2149450c2deea168e63c6d8cfc717e87` at 2026-10-26T07:24:14Z. RI-1–RI-3:222tests/18groups,4newtests/8scenarios,fmt/Clippy,43contracts/six indexes, independent source/final-document review and requiredCI passed. Source/merge ancestry, trailers and scoped remote readback PASS. Cancelled resumed stdin lock/write returns499 only after selected-run cleanup, without fallback/replay; dropped input retires the run. Healthy continuation and ordinary missing-input fallback covered; actual BrokenPipe maps to same branch by inspection. Original RED7.10s retained. Existing5second stop grace/best-effort OS cleanup preserved; HTTP-disconnect detection/general response-wait outside scope. No live provider or whole-product acceptance; owner decides desk done.

## T-0421 Claude first reply cancellation

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FR-1 | Cancel first-reply waits without fallback/replay | FR-1 | done | 2026-10-26T08:11:27Z | 2026-10-26T08:29:50Z | 2026-10-26T08:29:50Z |
| FR-2 | Release selected-run ownership on cancel/drop | FR-2 | done | 2026-10-26T08:11:27Z | 2026-10-26T08:29:50Z | 2026-10-26T08:29:50Z |
| FR-3 | Preserve healthy first reply and ordinary failures | FR-3 | done | 2026-10-26T08:11:27Z | 2026-10-26T08:29:50Z | 2026-10-26T08:29:50Z |

[Task and acceptance](T-0421-claude-first-cancel.md). Current token before first reply only; HTTP-disconnect and post-first-record behavior excluded.

Delivered in [Product PR662](https://github.com/fallrising/newclear/pull/662), source `5e1fa68d5ab18e18135bca27cc5df2aa1af1f978`, merge `c82260114659fc2978b56bf159a6efd5b561af45` at 2026-10-26T08:29:50Z. FR-1–FR-3:226tests/18groups,4newtests/18scenarios,fmt/Clippy,43contracts/six indexes, independent source/final-document review and requiredCI passed. Source/merge ancestry, trailers and scoped remote readback PASS. Current-token first-reply cancellation returns499 after selected-run cleanup without fallback/replay; drop retires the run. See task for exact markers, fixture limits and retained RED. Existing five-second grace/best-effort cleanup preserved; HTTP-disconnect and post-first-record cancellation outside scope. No live-provider or whole-product acceptance; owner decides desk done.


## T-0422 — Claude active output cancellation

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OC-1 | Cancel active output without partial success or replay | OC-1 | done | 2026-10-26T10:32:34Z | 2026-10-26T10:55:28Z | 2026-10-26T10:55:28Z |
| OC-2 | Release interrupted output resources before reporting | OC-2 | done | 2026-10-26T10:32:34Z | 2026-10-26T10:55:28Z | 2026-10-26T10:55:28Z |
| OC-3 | Preserve completed-turn ownership and reuse | OC-3 | done | 2026-10-26T10:32:34Z | 2026-10-26T10:55:28Z | 2026-10-26T10:55:28Z |

[Task and acceptance](T-0422-claude-output-cancel.md). Explicit active-output cancellation; HTTP-disconnect propagation excluded.

Delivered in [Product PR665](https://github.com/fallrising/newclear/pull/665), source `398c2e1521a3a33c5a77eb1239f409a4c666f98f`, merge `3300da0fccf3b0f573fa8692684491939a67bfa6` at2026-10-26T10:55:28Z. OC-1–OC-3:232tests/18groups,6newtests/19primaryscenarios (16actual-process/3state),37Claude-focusedtests,fmt/Clippy,43contracts/six indexes, independent source/final-document review and requiredCI passed. Source/merge ancestry, trailers and scoped remote content PASS. Explicit active-output cancellation waits for selected-run cleanup; original channel identity protects later sinks, and dropping a completed backpressured terminal preserves continuation. Two behavioral REDs and corrected test-only E0382 retained. HTTP disconnect propagation and never-polled response autonomous cancellation excluded; existing five-second grace/best-effort cleanup retained. No live-provider or whole-product acceptance; owner decides desk done.


## T-0423 — HTTP startup disconnect

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HD-1 | Verify connection-close cleanup during initial stdin | HD-1 | done | 2026-10-26T13:27:23Z | 2026-10-26T13:55:00Z | 2026-10-26T13:56:22Z |
| HD-2 | Establish transport and blocked-input evidence | HD-2 | done | 2026-10-26T13:27:23Z | 2026-10-26T13:55:00Z | 2026-10-26T13:56:22Z |
| HD-3 | Preserve healthy input/reuse and cancellation | HD-3 | done | 2026-10-26T13:27:23Z | 2026-10-26T13:55:00Z | 2026-10-26T13:56:22Z |

[Task and acceptance](T-0423-http-disconnect.md). Local HTTP/1 and fake-process boundary only.

Delivered in [Product PR667](https://github.com/fallrising/newclear/pull/667), source `04908a3107d5094956b012956b006788fe90ce69`, merge `2d89c37960367bc00b930733f2d3862831d84c7a` at 2026-10-26T13:55:00Z; required CI, independent source/final-document review and remote ancestry/trailers/scoped content PASS. 236 tests / 18 groups, four new tests / 20 primary scenarios, 37 existing Claude-focused tests, fmt/Clippy, 20 validator tests, 43 project contracts and six indexes PASS. Initial-write HTTP close already dropped startup ownership; the repair explicitly reaps the killed child to avoid a zombie. Raw RED/transport/state diagnostics and corrected test-only E0061/warning retained. Runtime teardown and filesystem removal remain best effort; no direct token-select, HTTP/2/proxy-wide or whole-product guarantee. Owner decides desk done.
