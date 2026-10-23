# Codex Usage 任務板

## T-0997 — 主線恢復（owner 直接指示，2026-10-23）

依賴：AC-01/02 → 指定已登入 target 與 schema → AC-03 → 同帳號可見 usage/status 的 AC-04。
狀態 done 依 repo 規則僅在合併後填寫；本地通過不等於已合併。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 997-01 | 本地通過：固定唯讀 RPC、資料與錯誤去識別、身份 fail-closed | AC-01 | in_progress | 2026-10-22T18:04:03Z | — | 2026-10-22T18:33:26Z |
| 997-02 | 本地 33 tests 通過、RED/GREEN 保留；不沿用 prototype 51 tests | AC-02 | in_progress | 2026-10-22T18:04:03Z | — | 2026-10-22T18:33:26Z |
| 997-03 | 本地 AC-03 通過：owner target 身份比對、CLI 0.163.0 真 snapshot exit 0 | AC-03 | in_progress | 2026-10-22T18:04:03Z | — | 2026-10-22T18:33:26Z |
| 997-04 | 等 owner 同帳號可見 usage/status；比對 window/reset/token null | AC-04 | todo | — | — | 2026-10-22T18:33:26Z |

本次報告：[2026-10-23-report.md](../evidence/2026-10-23-report.md)。本地完成不表示合併；AC-03 已通過；AC-04 等待同帳號可見讀值。

Live follow-up：[report](../evidence/2026-10-23-live-report.md)。

## T-0970 — Agent Usage 統一入口與重複能力整合

Owner 直接要求開發多來源並合併重複功能；產品主線仍以本元件 SUCCESS 與本板為準。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 970-1 | 本地通過：統一 JSON／table、局部結果、真 Codex／OpenCode | AU-01 | in_progress | 2026-10-23T06:53:46Z | — | 2026-10-23T07:12:48.297793Z |
| 970-2 | 本地通過：重用 collector／Claude readonly；Claude live 待設定 | AU-02 | in_progress | 2026-10-23T06:53:46Z | — | 2026-10-23T07:12:48.297793Z |
| 970-3 | 本地通過：來源能力誠實標示；manual 不當作自動接口 | AU-03 | in_progress | 2026-10-23T06:53:46Z | — | 2026-10-23T07:12:48.297793Z |
| 970-4 | 本地通過：負向／過期／隱私；獨立審查 ACCEPT | AU-04 | in_progress | 2026-10-23T06:53:46Z | — | 2026-10-23T07:12:48.297793Z |
| 970-5 | 本地通過：63+35 tests／文件契約；hosted CI／合併未跑 | AU-05 | in_progress | 2026-10-23T06:53:46Z | — | 2026-10-23T07:12:48.297793Z |

M2 本地實作已接受，仍依本板規則保持 in_progress 至合併。證據：[M2 report](../evidence/2026-10-23-agent-usage-report.md)。

## T-0972 — cc-quota 封存與統一歷史

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 972-1 | 本地完成：cc-quota封存／索引／舊prompt／來源保留 | AH-01 | in_progress | 2026-10-23T07:28:22.226575Z | — | 2026-10-23T07:41:16.003569Z |
| 972-2 | 本地通過：readonly history、84tests、5CLI流程 | AH-02 | in_progress | 2026-10-23T07:28:22.226575Z | — | 2026-10-23T07:41:16.003569Z |
| 972-3 | 本地通過：WAL先RED再修正、獨立複驗ACCEPT | AH-03 | in_progress | 2026-10-23T07:28:22.226575Z | — | 2026-10-23T07:41:16.003569Z |

M3 本地接受；未Git合併，依repo規則維持in_progress。初審REWORK與複驗ACCEPT見 [M3報告](../evidence/2026-10-23-history-report.md)。

## T-0975 — 已授權 Git 交付

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| 975-1 | 隔離候選、scope審查、CI、PR合併與遠端回讀 | AU-05／AH-01 | in_progress | 2026-10-23T10:37:08.779975Z | — | 2026-10-23T10:37:08.779975Z |

來源後續固定7項 FU-01–07 見 [SUCCESS](../../SUCCESS.md#t-0975--目前成果最終目標與交付)；已封存Claude Mac驗收留歷史，不再作獨立項目排程。
