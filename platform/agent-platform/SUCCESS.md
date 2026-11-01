---
project: platform/agent-platform
purpose: 以網頁派送、監看與介入隔離的程式代理任務
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

> **2026-11-01 current checkpoint**: Approved T-0449 readonly review passed its single actual window on `865ed05e`: retained Claude candidate → Codex verdict, exact result after Rust/AP restart, readonly/secret/network boundaries and cleanup. [Evidence](../fanzloud/docs/acceptance/M3-readonly-review.md). Independent ACCEPT_READONLY_ACTUAL_AND_NATIVE; PR952 merged as `a69ff34ec173ee36284aceebcb417e560438569c` after finalhead967727b2 passed AP41330719757/Fanz41330719768/contracts41330719829; remote Fanzloud/AP bytes read back equal.; full M3/FN07 remains open. Earlier dated checkpoints are historical.


# Agent Platform 成功契約

## 主線與範圍

主線是單一 operator 由 Web 建立固定 repository/base 的任務，在 Cocoon VM 執行 agent，處理審批與取消，並在重啟後取得可信成果。
[SDD](SDD.md) 的 M0–M4 與[最新交接](docs/HANDOFF.md)共同界定範圍；已完成的 mock 切片不取代整體 MVP。

多節點、ACP、排程及 webhook 屬後續。Agent Computer 桌面是獨立 Proposed 實驗。
單人版已延後真實計費與硬金額上限；費用維持 unknown，不能重新當成本片阻擋。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 固定來源與模擬模型，When 正常 worker 在真實 KVM 執行工具，Then 取得可核對 diff、驗證結果與完整停止證據 | historical | [正常 worker KVM](docs/WORKER-TOOLS-KVM.md) |
| AC-02 | Given 執行中的模型與工具，When 截止、取消或遭遇不明結果，Then 撤權、保留未知占用且不盲目重派 | historical | [M3 整合 mock 驗收](docs/M3-INTEGRATED-ACCEPTANCE.md) |
| AC-03 | Given 已封存成果與資料庫，When 隔離備份還原並重新登入，Then 成果 hash 保持一致且舊 session 失效 | historical | [單節點證據](docs/evidence/single-node.json) |
| AC-04 | Given 真實自然語言工作，When 由支援的模型完成任務並經正常操作收尾，Then 全部 M3/M4 與 MVP gate 有同版證據 | pending | [交接](docs/HANDOFF.md)：真實 coding、實際 runtime 部署、stale VM cleanup 與整體 gate 未完成 |

## 本次範圍：#379 owned-runner SIGINT cleanup

本次只修離線演練的 owned-runner 信號契約，不驗收完整 M4。

| AC ID | Given / When / Then | 狀態 | 驗證計畫 |
| --- | --- | --- | --- |
| SIG-01 | Given 一般或繼承 ignored SIGINT 的 owned runner，When wrapper 中斷，Then 啟動前建立合作式 SIGINT 契約並執行 ownership-checked finally | passed (offline) | [本次報告](tasks/379-owned-runner-signals/report.md)：原 fixture 45 秒 RED；真 runner + owned fake Docker 普通／ignored 回歸通過 |
| SIG-02 | Given 不合作子程序，When 45 秒 cleanup deadline 到期，Then bounded SIGKILL 並回報 cleanup incomplete | passed (offline) | [本次報告](tasks/379-owned-runner-signals/report.md)：production 45 秒不變，真 subprocess 的受控 wait seam 驗證 SIGKILL／incomplete |

不操作真 Docker、資料庫、VM、provider；完整 M4／live qualification 與 AC-04 仍 pending。

## 現況與缺口

2026-10-21 [最終 CI attempt 1](https://github.com/fallrising/newclear/actions/runs/39631545716/attempts/1) 的 673 項測試有一項 error：`test_runner_interrupt_preserves_python_cleanup` 回報 `rehearsal_cleanup_incomplete`。2026-10-23 在原 fixture 控制繼承 ignored SIGINT，可重現同一 45 秒錯誤；本次只在 owned test runner／fixture 的資源配置前明確建立 SIGINT 合作契約，8 項離線 boundary／signal 測試通過。歷史 CI 未記錄 signal disposition，故不能斷言該次根因；完整演練與 live gate 未重跑。詳見[本次報告](tasks/379-owned-runner-signals/report.md)。

M0–M2 已驗收，M3/M4 僅有多個已接受切片；不可把其合計稱作完整平台。
2026-10-06 單節點演練涵蓋真 TCP API、CLI worker、PostgreSQL 與 Web，模型仍是 local mock。
真 provider、live GitHub export、release 前長任務與主機 service-manager/TLS 尚缺對應證據。
歷史報告中較早失敗與停止指令有後續修正，應以交接頂端與逐切片結果判斷。

2026-10-21 的盤點僅新增驗收入口；本次 SIGINT 修正只限 test runner 與 fixture，保留原有驗收 assertions、ownership checks 與 45 秒停止界線。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[快速開始](docs/quickstart.md)、[單節點手冊](docs/SINGLE-NODE.md)列出 PostgreSQL、operator bootstrap、API/worker 與私人設定。

已核對入口：[operator CLI](src/agent_platform/cli.py)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make platform-check
make web-check
make browser-test
make deployment-rehearsal
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須補齊完整 MVP 的真實工作與恢復證據，核對 KVM／成果／維護流程對應合併 commit；尚不能建立全項目可用標記。

## 本次範圍：T-0380 FE 第 2 輪 R2-AC-4/E

僅實作已批准 [DESIGN M1–M3](fe-review/DESIGN.md)：隔離真 PostgreSQL／FastAPI 與 fake backend 的 review driver；現行 pausing 中文渲染回歸；審批錯誤／受理樣式與 zh-TW 短時間。不改後端、API、原 fixture、依賴、CI；不驗收完整平台或第 3 輪。

| AC | 狀態 | 驗證計畫 |
| --- | --- | --- |
| FE-M1 | passed (R2 local) | 兩次 fresh DB／新合成憑證，真登入／100 事件／結果／重連／設定／原生驗證；受控狀態覆寫分開標示；owned cleanup 與無秘密公開證據 |
| FE-M2 | passed (R2 local) | 共用 taskStateNames 已含 pausing 中文；補 App 實際渲染測試及補拍，不重複修改既有產品實作 |
| FE-M3 | passed (R2 local) | Approvals 錯誤 error、受理 notice、zh-TW 短時間的 RED/GREEN 測試及補拍 |
| FE-gates | local composite passed; CI/review pending | 原生 web check/build、Python check/platform-test、獨立 driver 型別／格式、安全邊界、獨立審查與 CI |

兩次完整 fresh captures 共 76 張（含早期 partial 為 114 raw）；web85 與 focused55、安全4通過。Python 原 641 tests/4環境 errors 保留，35 focused 原生補驗通過；exact-head CI 與獨立審查／合併待 parent。詳見 [本次報告](fe-review/tasks/round2/report.md)。上述平台主線 AC-04、usable_tag 與 live gate 維持原狀。

## 本次範圍：T-087 manual event retention

本次目標是 SDD §12/AT-13 的手動事件 retention：至少30天、明確 preview/apply approval、受限連續前綴、保留來源 dedupe 與 sequence、保護未完成或 cleanup 不明狀態，並可一致備份還原。實作前契約見 [EVENT-RETENTION](docs/EVENT-RETENTION.md)，Phase A 經獨立審查及 root ACCEPT 後於 `6ea13ad2` 固定並釋出 Phase B。下表真 PostgreSQL／native restore／browser 本機證據已由 T088 接受；初次額外648項 regression 為644pass/4fail，僅重跑4項後全通過，不宣稱 clean full suite。必要 CI／最終交付 gate 仍待完成，詳見[交付報告](tasks/379-event-retention/report.md)。

| AC | 狀態 | 驗證計畫 |
| --- | --- | --- |
| EVT-01 | passed | T084-retention-private-green3：24 項涵蓋30天 cutoff、mixed gap/recent/oversize 及 near-cap 多 run、exact approval/expiry/DB identity、eligibility、atomic rollback/replay |
| EVT-02 | passed | 同 source identity/seq、後續 floor 的 identity hash replay、兩種 producer/GC lock order、實際 Store.events floor/payload barrier、201-event follow SSE 與 pool default 均有 focused GREEN |
| EVT-03 | passed | 真 API/CLI focused GREEN；T084-retention-browser1 的真 GC→410→snapshot/suffix/result 1 項通過；保留非事件及 recovery facts |
| EVT-04 | passed | 原 key shapes＋七欄 equality guard／long-type backfill 與逐欄 mismatch 通過；T084-schema1 獨立 pin、T084-retention-private-backup2 共26項含真 native pruned-history restore、dedupe/hash/floor/receipt 與舊 plan 失效 |

此切片不實作 audit retention、stale VM cleanup、排程或部署，不改 adapter source ID/replay 或 lifecycle。AT-13/M4、AC-04 與 usable_tag 維持原狀。先前 socket／private-path／namespace 環境失敗保留於交付證據；未放寬安全 guard 或修改主機權限。

額外 regression 的3項 tool-process recovery 失敗伴隨 root driver 缺少 multiprocessing `__main__` guard／子程序重跑 selection 的 fixture 污染；driver 已修正。另1項 export-lock 失敗雖在 targeted rerun 通過，仍為 intermittent／原因未歸因，不能斷言由 driver 造成。

## 本次範圍：T-089 manual audit retention（2026-10-25 local snapshot）

SDD §12 的 audit90天保留已依[先行契約](docs/AUDIT-RETENTION.md)實作。契約先經 T090 獨立審查並提交11ac278f，再由 root 取得真 PostgreSQL RED 才釋出程式。Manual preview/apply 採至少90天嚴格 cutoff、固定 inspected-row/full-encoding caps、exact approval/expiry/DB identity；刪除 raw audit history，永久保留無 actor/action/target/decision 的最小 UUID/hash/size/time evidence。Audit target 非 typed run FK，不另發明 terminal/cleanup/export hold；獨立 operational authority 全保留。

| AC | 狀態 | 實際證據與範圍 |
| --- | --- | --- |
| AUD-01 | passed (local) | T091-audit-green3：22 focused GREEN，包含90天 equality、exact issued plan/expiry/UUID、nullable/unbounded metadata、fixed inspected-row/no-refill 及 encoded caps |
| AUD-02 | passed (local) | 同次驗證原子 receipt/tombstone/delete/new audit、current/prior transaction/wrong-ID、no resurrection、strict replay 與各步驟 rollback；最小永久證據無 raw audit 欄位 |
| AUD-03 | passed (local) | Full-row authority snapshots，加上實際 auth／command／worker／approval／recovery／model/tool unknown／export replay、writer/GC barriers 及 private CLI |
| AUD-04 | passed (local) | T091-schema1 獨立018 catalog pin；T091-audit-native1：audit、archive/history、event replay identity 三項真 native roundtrip 通過，舊 plan UUID 失效 |

此為有日期的本機證據快照；新增反例、獨立最終審查、hosted CI 與合併狀態見[交付報告](tasks/379-audit-retention/report.md)及其 PR。原有 event/archive 證據與初次失敗保留。完整 AT-13/M4、AC-04、stale cleanup、live qualification 與 usable_tag 維持原狀。

## Bounded scope: T-092 manual stale binding cleanup

The [contract](docs/STALE-CLEANUP.md) addresses a reachable terminal result whose
journaled release started but left its exact owned VM live. Baseline
`1b47738b08738978d53f2c551c1f5fabbf9325ba` preceded actual PostgreSQL/HTTP RED and
implementation. One separately approved request targets the original capability;
same-attempt replay only observes. Existing recovery alone releases capacity.

| AC | Local status | Evidence |
| --- | --- | --- |
| STALE-01 | passed | T094-stale-green1: real lifecycle fault, atomic legacy enrollment, exact one-binding approval/expiry, ownership and active-state refusal |
| STALE-02 | passed |28 focused tests include real SIGKILL/lease races; T094-inflight1 adds two real HTTP overlap winning orders with one physical effect and original intent preserved |
| STALE-03 | passed | T094-stale-native1: actual native roundtrip preserves ten authority tables and private journal facts, invalidates old approval, keeps drains; T094-affected1:12 existing guard/CLI regressions |

See the [dated delivery snapshot](tasks/379-stale-cleanup/report.md) for exact
commands/results and retained failures. Independent R2 review requested the HTTP
overlap fixture; its two cases passed without changing production. Hosted CI and
normal merge are separate delivery gates, tracked in the PR and task board.
This is not arbitrary orphan/host-residue cleanup or live VM qualification.
Complete AT-13/M4, AC-04, deployment and usable_tag remain open.

## Bounded scope: T-096 fake cross-flow acceptance

Add one same-version integration scenario to the delivered stale cleanup, export and
backup slices. No new production behavior is proposed. Existing independent tests
remain applicable; this targets their previously untested composition on one DB.
[Contract and verification plan](tasks/379-fake-composite/task.md).

| AC | Status | Verification plan |
| --- | --- | --- |
| COMP-01 | passed (local) | Real worker terminal result/release fault, exact approved cleanup, independent recovery, API-approved valid patch export via synthetic HTTP GitHub, PR-success/disconnect followed by read-only reconciliation |
| COMP-02 | passed (local) | Same scenario native dump/empty DB restore, durable result/export/control facts, private journal preservation, fresh maintenance identity and drained nodes; old approval refused with no repeat external mutation |

VM/model/GitHub remain synthetic. No existing suite rerun is itself new acceptance.
This is API/native integration, not browser qualification, complete fake E2E, live
smoke or whole AT09/12/13/M4. No deployment, release or usable tag.

T098-composite1 passed one new scenario in 2.234s on the frozen test source.
Actual command, source binding and limits: [delivery snapshot](tasks/379-fake-composite/report.md).
T097 independently accepted this bounded evidence; required changed-source CI and normal merge remain delivery gates.

## Bounded scope: T-100 browser retention/export composition

Test-only integration follows PR653. [Contract](tasks/379-browser-retention/task.md).

| AC | Status | Verification plan |
| --- | --- | --- |
| BGC-01 | passed (local) | Browser-approved A export, actual event/archive GC, real expired cursor reconnect and one fake HTTP export; same owned cohort |
| BGC-02 | passed (local) | Unreferenced B archive expires; stale browser approval/download refuse410, result/diff/hash remain |

Explicit synthetic historical INSERTs do not represent observed worker chronology.
No guard bypass or production changes. Full fake/live AT09/12/13, deployment and M4 remain open.

T102-browser3 passed one new scenario (9.8s); [snapshot](tasks/379-browser-retention/report.md)
retains both initial harness timeouts, exact source and boundaries. Normal CI/merge remain delivery gates.

## Bounded scope: T-104 expired export availability

[Prior contract](tasks/379-expired-export/task.md) corrects a UI gap observed in BGC01/02.

| AC | Status | Verification plan |
| --- | --- | --- |
| EUX-01 | passed (local) | Exact preview/approval410 expires only the original artifact immediately; refresh failure preserves known expiry and metadata |
| EUX-02 | passed (local) | Auth/transient/non-expiry/lost-response behavior and command keys remain correct; real BGC browser flow updates without another failed download |

Root obtains behavioral RED before product edits. This does not change backend authority
or complete full M4/live acceptance.

T106:30 distinct focused web cases and rebuilt-assets browser1/9.6s passed.
[Snapshot](tasks/379-expired-export/report.md) retains actual RED and two test corrections.
Independent review and required CI/normal merge remain delivery gates.

## Bounded scope: T-108 download expiry availability

[Prior contract](tasks/379-download-expiry/task.md) addresses the download path left
separate from PR658 export preview/approval. No backend or schema change.

| AC | Status | Verification plan |
| --- | --- | --- |
| DUX-01 | passed (local) | T110-unit1:15new+18EUX+5archive; exact410 pending/failed/stale metadata, identity/late-run/auth/error/success boundaries |
| DUX-02 | passed (local) | T110-browser1:freshbuild one real Chromium/API/SQLGC case3.5s; synthetic firstINSERT history, injected metadata network failure, explicit retry; scoped TS/format and test-helper Ruff |

No fullM4/live/deployment acceptance or usable tag.

## Bounded scope: T-112 Worker result truth in browser

[Test-only contract](tasks/379-result-truth/task.md) targets direct AT09 UI truth
after actual Worker outcomes; existing backend behavior is unchanged.

| AC | Status | Verification plan |
| --- | --- | --- |
| RTF-01 | passed (local) | T114-browser1 realWorker/scriptedHTTP failed and unknown/no-checks match API/archive/browser; actual download bytes/hash and live no-side-effect observations |
| RTF-02 | passed (local) | Same single scenario4.0s includes persist exception→interrupted/resultless/noarchive/held1/no release; reload/live observations unchanged; freshbuild/type/format/Ruff passed |

No SQL-state rewrite/trigger bypass or new product RED claim. Fullfake/live/M4 remains open.

## Bounded scope: T-0447 Fanzloud M1 external workspace

Owner approved the [external workspace contract](docs/EXTERNAL-WORKSPACE.md).
EX-01 contract, EX-02 real isolated workspace and EX-03 real subscription coding
are pending; no whole-platform or Fanzloud Web completion claim.

T-0447 EX01–03 have actual external-workspace evidence in [Fanzloud M1 acceptance](../fanzloud/docs/acceptance/M1-isolated.md): one official subscription CLI repair, fixed-base checks/diff, secret/egress/sequence isolation and observed cleanup. This does not close the remaining Agent Platform mainline or M4.

## T-0442 M2 — 2026-11-01 active scope

Owner requests the approved second-vendor/two-task milestone. [M2 contract](../fanzloud/docs/specs/SPEC-M2-two-vendors.md) fixes scope and checks before implementation. Codex tool/credential separation and concurrent isolation are NOT_RUN. Existing host authority remains one4CPU/4GiB VM and coding<=600s; parallel2 requires separate approval. No M3, API spend, public deployment or release.

M2 checkpoint2026-11-01: sourcea51a8663 actual Codex Web run142e9aee passed
fixed-base repair/check/download and confirmed cleanup; code and single-live independent
reviews accepted, native and hosted CI green. Two simultaneous workspaces/current shared
Claude route remain pending explicit resource approval. max_claims remains1; temporary
services stopped, no resident URL, no M3/AC05 or full platform completion claim.

M2 concurrent checkpoint2026-11-01: owner-approved bounded pair on d008fc47 passed actual
Claude repair, Codex cancellation, two live isolated workspaces, secret/network/traversal
denials and cancelA/completeB. Both cleaned; capacity restored1 and services stopped.
See [M2 acceptance](../fanzloud/docs/acceptance/M2-two-vendors.md). Fresh independent ACCEPT_M2_LIVE; final PR906 delivery pending.
Earlier pending-resource text is historical. M3/AC05 not started; mainline incomplete.

## T-0449 approved FN05 readonly dependency

Owner approval2026-11-01; [contract](../fanzloud/docs/specs/SPEC-M3-readonly-review.md) CU-M3-R01–04 and R01–05 govern this bounded extension. AP lifecycle/lease remains unique; candidate-only readonly review and explicit one-rework/two-review ceiling. Actual source865ed05e: one Codex review of retained Claude candidate accepted; exact archive reopened after Rust/AP restart, readonly OS/Connector boundaries and cleanup proven. Independent ACCEPT_READONLY_ACTUAL_AND_NATIVE; PR952 merged as `a69ff34ec173ee36284aceebcb417e560438569c` after finalhead967727b2 passed AP41330719757/Fanz41330719768/contracts41330719829; remote Fanzloud/AP bytes read back equal.; no full platform acceptance. Max1VM4CPU/4GiB,20min window, no new API spend/deploy/release.
