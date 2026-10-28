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


## T-0424 — Claude reply backpressure

[Scope and evidence](T-0424-reply-backpressure.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| BP-01 | Stop a continuation behind a retained completed reply | BP-1 | done | 2026-10-26T15:47:22Z | 2026-10-26T16:14:21Z | 2026-10-26T16:15:26Z |
| BP-02 | Release run resources under reply backpressure | BP-2 | done | 2026-10-26T15:47:22Z | 2026-10-26T16:14:21Z | 2026-10-26T16:15:26Z |
| BP-03 | Preserve healthy delivery and completed-request ownership | BP-3 | done | 2026-10-26T15:47:22Z | 2026-10-26T16:14:21Z | 2026-10-26T16:15:26Z |

Product [PR671](https://github.com/fallrising/newclear/pull/671) merged `9905b731189f5756c8584251eb01cc183bcd0daf` at 2026-10-26T16:14:21Z; required CI, independent source review and remote content/ancestry/trailers passed. BP-1–BP-3 close at that observed product merge. Linux fake-process backpressure evidence; unchanged idle-timer, graceful-shutdown and runtime boundaries remain in the task.

## T-0425 — Claude idle expiry

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| IE-1 | 完成階段背壓下既有 idle 期限與資源回收 | IE-1 | done | 2026-10-26T16:48:56Z | 2026-10-26T17:08:03Z | 2026-10-26T17:08:59Z |
| IE-2 | 健康續輪及後續階段期限所有權 | IE-2 | done | 2026-10-26T16:48:56Z | 2026-10-26T17:08:03Z | 2026-10-26T17:08:59Z |
| IE-3 | 完整交付、既有取消回歸與交接 | IE-3 | done | 2026-10-26T16:48:56Z | 2026-10-26T17:08:03Z | 2026-10-26T17:08:59Z |
T-0425 delivered by [PR675](https://github.com/fallrising/newclear/pull/675), source `2922bcd0821d04ea2319e6ec884527a60902aa2d`, merge `f522b53b0787c4d88827513fc78a0a2f22268913` at 2026-10-26T17:08:03Z. IE-1–IE-3:245 Rust tests/18groups,46 Claude-focused,4 new tests/8primarycases plus1healthyreplacement; fmt/Clippy,20validators,44contracts/7indexes and independent source/final-document review passed. Required check/validate, normal merge and remote source+merge trailer/ancestry/scoped-content readback passed. Original idle-expiry RED and corrected missing-reactor test-harness failure retained; Linux fake-process/finite-clock evidence and runtime/transport boundaries remain as documented in SUCCESS/task. This row closure is the separate board publication; desk remains in_progress for owner disposition.

## T-0426 — Mainline acceptance convergence

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| MC-1 | 核對AC-03來源與當前離線驗收 | MC-1 | done | 2026-10-26T17:59:19Z | 2026-10-26T18:23:28Z | 2026-10-26T18:23:32Z |
| MC-2 | 固定主線剩餘驗收與既有依賴 | MC-2 | done | 2026-10-26T17:59:19Z | 2026-10-26T18:23:28Z | 2026-10-26T18:23:32Z |
| MC-3 | 完整驗證、獨立審查與交接 | MC-3 | done | 2026-10-26T17:59:19Z | 2026-10-26T18:23:28Z | 2026-10-26T18:23:32Z |

T-0426 delivered by [PR680](https://github.com/fallrising/newclear/pull/680), source `cec93f9f9d12f77b2a1ce3817612e9f42bd0f4c7`, merge `e09af2d0ca8815ae6b51dc9b61bb030460c7ec0e` at 2026-10-26T18:23:28Z. MC-1–MC-3 documentation/evidence scope: all17 original core requirements preserved; AC-03 local admission acceptance reconciled, three live acceptance groups and existing T-1102 runtime dependency remain. No runtime/tests/Cargo changes. Full245 Rust tests/18groups, fmt/Clippy,20validators,44contracts/7indexes and independent source/content review passed. Original focused startup failure (8/9, gateway exited before health) retained with unknown cause; unchanged exact retry and subsequent full suite passed. Necessary check/validate, normal merge, source/merge trailers, ancestry and scoped-content readback passed. Whole product remains incomplete/no usable tag; desk remains in_progress for owner disposition.

## T-0427 — D-06 error persistence

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| EP-1 | 合成錯誤持久化重現及最小修正 | EP-1 | done | 2026-10-27T11:12:44Z | 2026-10-27T12:41:18Z | 2026-10-27T12:41:24Z |
| EP-2 | fallback／CLI／協定及資料語意回歸 | EP-2 | done | 2026-10-27T11:12:44Z | 2026-10-27T12:41:18Z | 2026-10-27T12:41:24Z |
| EP-3 | 完整驗證、審查、發布與交接 | EP-3 | done | 2026-10-27T11:12:44Z | 2026-10-27T12:41:18Z | 2026-10-27T12:41:24Z |
Delivered by [PR683](https://github.com/fallrising/newclear/pull/683), source `6411a7c8ef1bdca2e0f2aa7b01e6345a6d458e8b`, merge `19b7296d5142e0fe5c6d682ce0ab5c65255a0f67` at 2026-10-27T12:41:18Z. D-06 synthetic privacy RED→GREEN;247 Rust tests/19groups,fmt/Clippy,20validators,44contracts/7indexes and independent source/evidence review passed. Required check/validate and source/merge trailer/ancestry/scoped-content readback passed. Original cached compiler-query failure retained; fresh metadata query kept shared sccache/target. Historical rows/caller errors unchanged; D-01–D-05, broaderUC-R05/M-15 and live gates remain open. This closes only the bounded product rows; desk stays in_progress for owner disposition.

## T-0428 — Buffered cost completeness

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CE-1 | 缺值持久化 RED 與來源觀測 | CE-1 | done | 2026-10-27T16:48:22Z | 2026-10-27T17:02:23Z | 2026-10-27T17:02:34Z |
| CE-2 | 完整雙價格估算與既有語意 | CE-2 | done | 2026-10-27T16:48:22Z | 2026-10-27T17:02:23Z | 2026-10-27T17:02:34Z |
| CE-3 | 完整驗證審查及交付 | CE-3 | done | 2026-10-27T16:48:22Z | 2026-10-27T17:02:23Z | 2026-10-27T17:02:34Z |

Delivered by [PR689](https://github.com/fallrising/newclear/pull/689), source `39b210c53916bea7c2e9044fb9aac654cf2bba98`, merge `6362f75fb0d591fa17653cf67a8893f148055a18` at 2026-10-27T17:02:23Z. Scoped buffered completeness:126cases/3newRusttests, genuine82baseline mismatches per surface then identicalfixture GREEN; full250tests/20groups,fmt/Clippy,20validators,44contracts/7indexes and independent source review passed. Necessary CI, normal merge and remote source/merge trailer/ancestry/scoped-byte readback passed. Original fixture errors and unintended synthetic Antigravity request returning401 retained; final HTTP fixtures use a non-forwarding loopback fake proxy. Antigravity HTTP remains unverified, offline parser only; broaderD05/T1102 and real acceptance remain open. Only these bounded rows close; desk stays in_progress for owner disposition.

## T-0429 — Cost aggregate coverage

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CC-1 | 費用缺值與coverage RED→GREEN | CC-1 | done | 2026-10-28T04:04:28Z | 2026-10-28T04:25:47Z | 2026-10-28T04:26:25Z |
| CC-2 | API/Web/TUI一致呈現與CSV回歸 | CC-2 | done | 2026-10-28T04:04:28Z | 2026-10-28T04:25:47Z | 2026-10-28T04:26:25Z |
| CC-3 | 完整驗證審查與交付 | CC-3 | done | 2026-10-28T04:04:28Z | 2026-10-28T04:36:26Z | 2026-10-28T04:37:37Z |

產品 [PR692](https://github.com/fallrising/newclear/pull/692) source `e45e392843c0f002563d96e09a94f5bac3e36a1a`、merge `fb03c5bd1d27e33c16b0c95dce7cb7b4803803e9` at 2026-10-28T04:25:47Z。完整 254 Rust tests／21 組、fmt、Clippy、20 validator tests、44 contracts／7 indexes 及獨立來源審查通過；必要 CI、正常合併與遠端 trailer／祖先／逐檔內容回讀通過。

六種合成資料情境、4個新增 Rust tests；空資料／未知／部分小計／完整估算／明確零值在 API、Web、TUI 與 doctor 一致；事件 CSV 和 usage rows 未改寫。首次完整套件的 fixture401 與其原因未知保留；exact retry 和最終完整套件通過。本輪只處理既有 USD 儲存估算的費用彙總；coverage 是 non-null rows 比率，不保證歷史品質或帳單正確。原 f64 精度、token/latency 彙總、provider/currency/basis 分組、D-01–D-05 其他工作及真實驗收仍未完成。mainline incomplete、usable_tag none，desk 保留 in_progress，done 由 owner 決定。

CC-3 整輪驗收已於 2026-10-28T04:37:37Z 核對：產品 PR692、看板 PR694、journal PR149 與 desk PR258／PR259 均已正常合併，必要 CI、來源／merge trailers、祖先與逐檔回讀通過；獨立來源及帳本審查、完整證據備份核對、五個原工作樹清理已完成，分支與共享快取保留。CC-3 end 欄記初次看板合併時間；本段為完成後的驗收紀錄，其發布亦須通過必要 CI／審查與合併回讀。歷史失敗及未完成產品邊界不變，desk 仍由 owner 決定 done。

## T-0430 — Repeatable offline user journey

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| J-1 | 完整離線請求與工具旅程 | J-1 | done | 2026-10-28T05:14:23Z | 2026-10-28T05:40:25Z | 2026-10-28T05:40:51Z |
| J-2 | 真實觀測用量與缺口呈現 | J-2 | done | 2026-10-28T05:14:23Z | 2026-10-28T05:40:25Z | 2026-10-28T05:40:51Z |
| J-3 | 可操作入口與安全生命週期 | J-3 | done | 2026-10-28T05:14:23Z | 2026-10-28T05:40:25Z | 2026-10-28T05:40:51Z |
| J-4 | 完整本機驗證及產品交付 | J-4 | done | 2026-10-28T05:14:23Z | 2026-10-28T05:40:25Z | 2026-10-28T05:40:51Z |

產品 [PR703](https://github.com/fallrising/newclear/pull/703) source `479263c0be87d9cc608477812cef2be6722b111a`、merge `01ce1eb20e2c63a231265cc1be929f20a084e7e4` at 2026-10-28T05:40:25Z；完整254Rusttests/21groups、fmt、Clippy、20Python回歸、實際九階段check及serve停機、20validator tests、44contracts/7indexes、獨立來源審查、必要CI及正常合併／遠端回讀通過。

可重跑入口與操作說明：[離線完整流程](../OFFLINE-WALKTHROUGH.md)。實際17筆usage中11筆已知、6筆未知；合成估價$22僅為fixture，不是真實花費。技術J1–J4已依產品合併回讀完成；後續管理帳本、備份與清理依最終handoff記錄，不由這個產品AC冒稱完成。主線仍incomplete、usable_tag none；17項原核心AC、原T-1102規格、Rust/Cargo及其他tracked plan不變。串流結算與終態/時間、其餘計量、client/version與真實AC01/04/08、既有fixture可靠性及Antigravity隔離仍分別記錄於newclear #698–702；不宣稱只剩三個任務或完成百分比。desk保留in_progress，done由owner決定。

## T-0432 generic Chat stream settlement

- Demand: [desk T-0432](https://github.com/fallrising/desk/tree/main/tasks/T-0432-thinrouter-stream-settlement); [fixed SS-1–SS-6/design](T-0432-stream-settlement.md).
- Status: in_progress; started2026-10-28T13:24:29Z; claimPR270 merged. Source/design and actual RED→GREEN complete;279Rusttests/22groups,fmt/Clippy,Python20tests,nine-stage journey and repository gates passed. Independent review and productPR712/check+validate/normalmerge/readback passed; management ledger publication/backup/cleanup are recorded by the final handoff.
- Scope: generic API-key HTTP Chat stream only; #698 remains open for other paths. Estimate2–3active hours;20minute checkpoints; no real providers.

產品 [PR712](https://github.com/fallrising/newclear/pull/712) source `c3e9340024e50f95762f71174f57386e1f84bb0c`、merge `17e1ed121d35229471ff834ef5ea55b3d0d2cf94` at 2026-10-28T14:21:21Z；279Rusttests/22groups、fmt、Clippy、20Python回歸、實際九階段無桌面旅程、20validator tests、45contracts/7indexes、獨立來源審查、必要check/validate CI與正常合併／遠端回讀通過。

SS-1–SS-5及SS-6產品驗證/交付通過；本輪管理帳本、備份與清理以finalhandoff記錄，不由產品合併預先冒稱完成。完整旅程17rows/12known/5unknown，合成$24小計仍partial，非真實花費。僅generic API-key HTTP Chat streaming；其他client protocol、CLI、named-provider/OAuth仍未接入本輪observer，完整#698保持open。#699完整token coverage／price provenance、#700具名client/version與真實AC01/04/08、#701既有fixture啟動/auth間歇失敗、#702Antigravity隔離仍未完成。mainline incomplete、usable_tag none，原17coreAC／T-1102規格／Cargo／其他trackedplan不變；desk維持in_progress，done由owner決定。沒有完成百分比。

## T-0432 three-client settlement continuation

Demand: [desk T-0432](https://github.com/fallrising/desk/tree/main/tasks/T-0432-thinrouter-stream-settlement); [PC-1–PC-5](T-0432-protocol-settlement.md). Claim PR273 merged before product edits.

| ID | Task | AC | Status | Start | End | Last activity |
| --- | --- | --- | --- | --- | --- | --- |
| PC-1 | Observed tail usage across clients | PC-1 | done | 2026-10-28T15:21:44.837545Z | 2026-10-28T16:00:53Z | 2026-10-28T16:00:53Z |
| PC-2 | Converter terminal ownership | PC-2 | done | 2026-10-28T15:21:44.837545Z | 2026-10-28T16:00:53Z | 2026-10-28T16:00:53Z |
| PC-3 | Fallback/cancel/storage/restart | PC-3 | done | 2026-10-28T15:21:44.837545Z | 2026-10-28T16:00:53Z | 2026-10-28T16:00:53Z |
| PC-4 | Headless journey reconciliation | PC-4 | done | 2026-10-28T15:21:44.837545Z | 2026-10-28T16:00:53Z | 2026-10-28T16:00:53Z |
| PC-5 | Verification and delivery | PC-5 | in_progress | 2026-10-28T15:21:44.837545Z | — | 2026-10-28T15:21:44.837545Z |

產品 [PR720](https://github.com/fallrising/newclear/pull/720) source `1babddfc593d721a5fcebd78fc8e445be5689b46`、merge `2cb50ea4623a51206ed47868c99bdb6d8a39b7db` at 2026-10-28T16:00:53Z；290Rusttests/22groups、fmt/Clippy/build、26Python回歸（含serve/cleanup）、實際九階段終端旅程、20validator tests、45contracts/7indexes及獨立來源審查通過；必要check/validate CI、正常合併與遠端內容／祖先／trailer回讀通過。

實際九階段旅程17筆usage、14已知3未知，合成估價已知小計$28且coverage partial；三種正常串流皆原始上游5/3、succeeded/complete、唯一request/attempt與有序時間，API/CSV及HTML金額/coverage、重啟歷史一致。這是fixture估價，不是provider帳單或整輪開發實耗。 本輪僅generic API-key Chat HTTP上游→Chat/Messages/Responses clients；CLI、named-provider/OAuth/借用憑證及原生非Chat上游仍未接入observer，完整#698仍open。#699token coverage/價格來源精度/歷史語義、#700具名client/version與真實AC01/04/08及AC04工具/AC17文字範圍決策、#701既有fixture啟動/auth間歇失敗、#702Antigravity HTTP隔離仍保留。mainline incomplete、usable_tag none、desk in_progress；owner決定done，沒有整體完成百分比。

PC-1–PC-4依產品合併回讀完成。PC-5的產品驗證/交付部分已通過；本表是此時點快照，管理帳本發布、備份核對與工作樹清理的實際最終結果見本輪`.local/t0432-protocol-settlement/handoff.json`，不預先將尚未執行的步驟標成通過。

## T-0432 — Claude Code provider settlement

Fixed CS1–5: [task](T-0432-claude-settlement.md). These rows record the delivered product/source runtime gate; final administrative closure is in the handoff.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CS-01 | Per-dispatch reservation and independent reply identity | CS-1 | done | 2026-10-28T17:13:01Z | 2026-10-28T18:01:57Z | 2026-10-28T18:01:57Z |
| CS-02 | Conservative raw counters, terminal/time and durable recovery | CS-2–CS-4 | done | 2026-10-28T17:13:01Z | 2026-10-28T18:01:57Z | 2026-10-28T18:01:57Z |
| CS-03 | Three-client headless fakeCLI journey and independent source/runtime review | CS-5 product validation | done | 2026-10-28T17:13:01Z | 2026-10-28T18:01:57Z | 2026-10-28T18:01:57Z |

產品 [PR729](https://github.com/fallrising/newclear/pull/729) source `d7e91159caf3699f17c8cfdc6e5e03f3d57c58d8`、merge `cef2b3f0f0f408171429fe4abb95f1a8b2799168` at 2026-10-28T18:01:57Z；最終313Rusttests/22groups、fmt/Clippy/lockedbuild、35Python、20validator tests、45contracts/7indexes、Claude及genericHTTP各九階段旅程、獨立來源/執行審查通過；必要check/validate CI、正常合併與遠端內容/祖先/Desk-Task trailer回讀通過。

Claude實際隔離旅程17筆durableattempt，全17費用unknown/null；原始input/output/cache數值保留，缺cache不補零，沒有足夠資料的總輸入仍unknown。三協定工具續輪、fallback/error/cancel/stall、HTML/API/CSV一致與同進程/重啟resume皆核對。CLI版本/cache schema未經真實廠商驗證，成功result/session總數不記為單輪usage。genericHTTP回歸保留fixture$28partial估價，兩者均非provider帳單或開發實耗。

僅既有Claude Code provider→Chat/Messages/Responses串流記帳；Cursor、其他named-provider/OAuth/借用憑證與原生非Chat上游observer仍未完成，完整#698保持open。#699完整token coverage/價格來源精度/歷史語義、#700具名client/version及真實AC01/04/08與AC04工具/AC17文字範圍決策、#701既有fixture啟動/auth間歇失敗未知原因、#702Antigravity HTTP隔離保留。mainline incomplete、usable_tag none、desk in_progress；owner決定done，不用任務數或完成百分比取代產品驗收。

管理帳本發布、完整備份`/home/ckc/test/backup/t0432-claude-settlement-20261028`與本輪工作樹清理由最終`.local/t0432-claude-settlement/handoff.json`核實；這份產品merge時點快照不預先宣稱其後步驟完成。新`local-demo.py`預設check並驗source/binarydigest，先前入口及舊digest保留。此輪完成即停止，不開新里程碑。
