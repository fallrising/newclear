# 任務板

## T-0003 — 自動忠實度檢查與由筆記產生的狀態

輸入：owner 直接指示。範圍是自動對照腳本、來源文字快取、可重現抽樣、升格 reviewed 的做法，以及 SUCCESS／inventory／PR 片段與筆記重算結果的 CI 對帳。不改任何筆記的 `note_status`，不在 CI 呼叫模型。T-0003-1～3 已隨 #1013 合併（`a285669c`）。之後以 pi 對 280 篇跑一次自動檢查並抽樣，見[驗證紀錄](../verification.md)。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-1 | 快取來源文字投影，並以可插拔命令或 API 做忠實度檢查；沒有金鑰則略過模型 | AC-F03 | done | 2026-11-03T02:20:00Z | 2026-11-03T02:45:02Z | 2026-11-03T03:57:24Z |
| T-0003-2 | 可重現抽樣與批次升格 reviewed 的命令；本 PR 不執行升格 | AC-F02、AC-F03 | done | 2026-11-03T02:20:00Z | 2026-11-03T02:45:02Z | 2026-11-03T03:57:24Z |
| T-0003-3 | 由筆記產生篇數與 source_commit，CI 比對 SUCCESS、inventory 與 PR 片段 | AC-F07 | done | 2026-11-03T02:20:00Z | 2026-11-03T02:45:02Z | 2026-11-03T03:57:24Z |

## T-0002 — 以來源快照為分母的全量 catalog

輸入：owner 2026-11-02 直接指示。範圍與驗收：[SDD](../../SDD.md) 的 AC-F01 至 AC-F07（SUCCESS 列號 AC-05 至 AC-11）。執行者：本次主導 agent。未授權 merge、deploy、release、tag、force push。

T-0001 維持原完成紀錄，不改寫成這次全量任務。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-1 | 來源快照盤點、去重與入口差異 | AC-F01 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-2 | 全量筆記與缺漏對帳 | AC-F02 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-3 | 逐篇來源、文末引用與證據分層 | AC-F03 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-4 | schema 2、分類、狀態與關聯契約 | AC-F04 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-5 | 全量網站的搜尋、分類、詳情與無 JS 導航 | AC-F05 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-6 | 離線確定性、跳脫與狀態負向測試 | AC-F06 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-7 | 元件測試與 repo 索引檢查 | AC-F07 | in_progress | 2026-11-02T14:34:00Z |  | 2026-11-02T15:01:00Z |
| T-0002-8 | 撤下模板分析：逐篇模型重寫、全部改為 draft、產生器不再寫 reviewed；尚待人工逐篇審閱 | AC-F02、AC-F03 | in_progress | 2026-11-02T16:40:00Z |  | 2026-11-02T18:30:00Z |

## T-0001 — Gameplay Atlas metadata 與 design pattern catalog

輸入：owner 2026-11-02 直接指示。範圍與驗收：[SDD](../../SDD.md)。執行者：本次主導 agent。owner 於本輪明確批准先合併，取代初始 Draft-only 停止條件。

[PR #960](https://github.com/fallrising/newclear/pull/960) 已於 2026-11-02T11:21:08Z 正常合併；合併 SHA：`2ec3c70043f7de0b4b347737a4bbaab1208e152e`。未 deploy、release、打 usable tag 或執行全量擴充。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-1 | 網站 metadata、欄位契約與維護指南；已驗證並合併 | AC-01 | done | 2026-11-02T09:37:46Z | 2026-11-02T11:21:08Z | 2026-11-02T11:21:08Z |
| T-0001-2 | 14 篇筆記與逐篇來源；已驗證並合併 | AC-02 | done | 2026-11-02T09:37:46Z | 2026-11-02T11:21:08Z | 2026-11-02T11:21:08Z |
| T-0001-3 | 靜態網站、搜尋、分類、手機版與無 JS 導航；最新合併快照驗證通過 | AC-03 | done | 2026-11-02T09:37:46Z | 2026-11-02T11:21:08Z | 2026-11-02T11:21:08Z |
| T-0001-4 | 18 項測試與四項 CI 成功；正常合併並回讀 commit/tree | AC-04 | done | 2026-11-02T09:37:46Z | 2026-11-02T11:21:08Z | 2026-11-02T11:21:08Z |

### 合併驗收與回讀

- 經核對的最新 main：`1bf6c5061fef946d5b9a2a4088ad701dfab49ff4`；PR head：`98d0b36e65c56cb7ac2c5257884e1617095fcb01`。
- GitHub 測試合併快照：`034c63db938083bc3b37e7a78ff6d19734b79229`；其 parents 為上述 main 與 head。
- [Catalog CI](https://github.com/fallrising/newclear/actions/runs/41435993898)、[Project success contracts](https://github.com/fallrising/newclear/actions/runs/41435993736)、[llms.txt CI](https://github.com/fallrising/newclear/actions/runs/41435993995)、[Workflow static validation](https://github.com/fallrising/newclear/actions/runs/41435993766) 均為 completed / success。
- 合併使用 expected_head_sha，沒有 force、改寫歷史或略過檢查。回讀 PR merged=true、main SHA 與實際 merge commit；其 tree `7a65ac72c856c59d783ef83f445b283643bdcfdf` 與已測試快照完全一致。
- 無未解決 review thread，未聲稱存在獨立審查。依根 AGENTS，以只改本任務板的 PR 補登 done 與合併時間；本紀錄不另開遞迴收尾任務。

### 邊界與歷史文件

本次完成的是 14 篇精選 catalog，不是原站全量 catalog。完整 catalog 本輪只確認可行性，沒有把既有 AC 改成 280 篇完成宣告。

[SUCCESS](../../SUCCESS.md)、[SDD](../../SDD.md) 與 [verification](../verification.md) 內的 Draft-only／等待合併敘述是先前候選的歷史快照；本節記錄後續 owner 授權與實際合併。只有本次有界交付已合併，不宣稱部署、release 或新增可用版本標記。
