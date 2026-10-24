# Codex Usage 任務板

## T-0997 — 主線恢復（owner 直接指示，2026-10-23）

依賴：AC-01/02 → 指定已登入 target 與 schema → AC-03 → 同帳號可見 usage/status 的 AC-04。
狀態 done 依 repo 規則僅在合併後填寫；本地通過不等於已合併。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 997-01 | 本地通過：固定唯讀 RPC、資料與錯誤去識別、身份 fail-closed | AC-01 | done | 2026-10-22T18:04:03Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 997-02 | 本地 33 tests 通過、RED/GREEN 保留；不沿用 prototype 51 tests | AC-02 | done | 2026-10-22T18:04:03Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 997-03 | 本地 AC-03 通過：owner target 身份比對、CLI 0.163.0 真 snapshot exit 0 | AC-03 | done | 2026-10-22T18:04:03Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 997-04 | 等 owner 同帳號可見 usage/status；比對 window/reset/token null | AC-04 | todo | — | — | 2026-10-22T18:33:26Z |

本次報告：[2026-10-23-report.md](../evidence/2026-10-23-report.md)。本地完成不表示合併；AC-03 已通過；AC-04 等待同帳號可見讀值。

Live follow-up：[report](../evidence/2026-10-23-live-report.md)。

## T-0970 — Agent Usage 統一入口與重複能力整合

Owner 直接要求開發多來源並合併重複功能；產品主線仍以本元件 SUCCESS 與本板為準。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 970-1 | 本地通過：統一 JSON／table、局部結果、真 Codex／OpenCode | AU-01 | done | 2026-10-23T06:53:46Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 970-2 | 本地通過：重用 collector／Claude readonly；Claude live 待設定 | AU-02 | done | 2026-10-23T06:53:46Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 970-3 | 本地通過：來源能力誠實標示；manual 不當作自動接口 | AU-03 | done | 2026-10-23T06:53:46Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 970-4 | 本地通過：負向／過期／隱私；獨立審查 ACCEPT | AU-04 | done | 2026-10-23T06:53:46Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 970-5 | 本地通過：63+35 tests／文件契約；hosted CI／合併未跑 | AU-05 | done | 2026-10-23T06:53:46Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |

M2 本地實作已接受，仍依本板規則保持 in_progress 至合併。證據：[M2 report](../evidence/2026-10-23-agent-usage-report.md)。

## T-0972 — cc-quota 封存與統一歷史

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 972-1 | 本地完成：cc-quota封存／索引／舊prompt／來源保留 | AH-01 | done | 2026-10-23T07:28:22.226575Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 972-2 | 本地通過：readonly history、84tests、5CLI流程 | AH-02 | done | 2026-10-23T07:28:22.226575Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |
| 972-3 | 本地通過：WAL先RED再修正、獨立複驗ACCEPT | AH-03 | done | 2026-10-23T07:28:22.226575Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |

M3 本地接受；未Git合併，依repo規則維持in_progress。初審REWORK與複驗ACCEPT見 [M3報告](../evidence/2026-10-23-history-report.md)。

## T-0975 — 已授權 Git 交付

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 975-1 | 隔離候選、scope審查、CI、PR合併與遠端回讀 | AU-05／AH-01 | done | 2026-10-23T10:37:08.779975Z | 2026-10-23T10:41:19Z | 2026-10-23T10:41:19Z |

來源後續固定7項 FU-01–07 見 [SUCCESS](../../SUCCESS.md#t-0975--目前成果最終目標與交付)；已封存Claude Mac驗收留歷史，不再作獨立項目排程。

## PR #527 交付結果（最新狀態）

- 程式與封存：[PR #527](https://github.com/fallrising/newclear/pull/527) 已於 `2026-10-23T10:41:19Z` 合併。
- 實測／審查 head：`4419528b8d318363b22c1cedb6a3c32200e0a4ee`；merge：`a6c727ad83c337670dba52f3e020e9247c31321d`。
- 已fetch並確認merge在origin/main祖先鏈，遠端5個實作／測試hash與通過T-974／T-975的manifest一致。
- 最終HEAD CI全部SUCCESS：[Agent Usage CI](https://github.com/fallrising/newclear/actions/runs/39940754177)、[cc-quota相容CI](https://github.com/fallrising/newclear/actions/runs/39940754127)、[42項目契約](https://github.com/fallrising/newclear/actions/runs/39940754335)、[llms.txt](https://github.com/fallrising/newclear/actions/runs/39940754203)。
- Agent Usage工作流在Python3.11完成unified／Codex tests、封存相容tests及compile；cc-quota在Linux／macOS3.11成功，Mac原生synthetic邊界成功。這些不是真人Claude usage／通知驗收。
- 本機隔離候選84＋35＝119項不同測試通過，42contracts/index通過；獨立T-975 scope／hash／privacy ACCEPT。
- 初次commit因未設定作者未產生提交；後續僅用單次git參數指定Codex automation身份，沒有改全域設定。首次sandbox push因系統SSH設定讀取失敗，核准沙箱外重試成功；無force／CI bypass。
- 本節以board-only PR依repo規則補end/done。先前文內「未提交／CI未跑／未授權」都是當時階段紀錄，最新交付以本節為準。

尚待來源工作仍為 **7項 FU-01–07**：Codex可見status對照、Claude真資料、Cursor真Admin spend、OpenCode Go／Grok／Grok Bot／Antigravity自動quota接入。
原AC-04維持todo/pending，整體主線incomplete／usable_tag:none；其他11條驗收在其明示範圍passed，不等於全面自動查額度。
cc-quota保持封存、歷史未驗Mac情境保留；沒有tag／release／deploy，沒有資料／設定／既有服務操作。

## T-1101 — Langfuse 整合文件先行

需求來源：owner 於 2026-10-24 直接要求將 Langfuse 比較後續拆成開發與修正兩個文件 PR。
承接者：Codex 主導；範圍限本文件里程碑。規格路徑：`docs/specs/llm-observability-langfuse.md`。
本次建立 Draft PR，runtime 實作、真帳號驗收、部署與合併不在本次交付內；不變更既有產品驗收狀態。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| LD-D01 | 定義訂閱額度、執行觀測與控制責任的整合範圍 | LD-D01 | in_progress | 2026-10-24T14:17:37Z | — | 2026-10-24T14:17:37Z |
| LD-D02 | 定義來源、關聯 ID、計量、去重、隱私與失敗契約 | LD-D02 | in_progress | 2026-10-24T14:17:37Z | — | 2026-10-24T14:17:37Z |
| LD-D03 | 定義分階段實作依賴、驗收矩陣與文件交付證據 | LD-D03 | in_progress | 2026-10-24T14:17:37Z | — | 2026-10-24T14:17:37Z |
