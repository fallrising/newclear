# Agent Secrets 任務板

## T-0959 — 文件先行：HSM 基線與 Agent 憑證存取

來源：[issue #959](https://github.com/fallrising/newclear/issues/959)；owner 直接指示。執行者：ChatGPT。
範圍只有 SDD 與文件交付，不實作、不 release、不 deploy。時間為 UTC RFC3339。
初次交付停在 Draft；owner 於 2026-11-02 明確追加「好 合併PR」，因此完成文件 PR 合併及本任務板收尾，沒有擴大後續開發授權。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0959-01 | 固定來源、模組與差異文件已合併 | AC-001 | done | 2026-11-02T09:52:31Z | 2026-11-02T10:43:52Z | 2026-11-02T10:45:05Z |
| T-0959-02 | docs/SDD.md 文件規格已合併 | AC-002 | done | 2026-11-02T09:52:31Z | 2026-11-02T10:43:52Z | 2026-11-02T10:45:05Z |
| T-0959-03 | Agent Proposed 安全邊界文件已合併；未授權實作 | AC-003 | done | 2026-11-02T09:52:31Z | 2026-11-02T10:43:52Z | 2026-11-02T10:45:05Z |
| T-0959-04 | 驗收契約與專案導航已合併 | AC-004 | done | 2026-11-02T09:52:31Z | 2026-11-02T10:43:52Z | 2026-11-02T10:45:05Z |
| T-0959-05 | PR #961 檢查通過、正常合併與主線回讀完成 | AC-005 | done | 2026-11-02T09:52:31Z | 2026-11-02T10:43:52Z | 2026-11-02T10:45:05Z |

## 合併與驗證紀錄

認領先於規格提交；認領 commit：`134075f436a0bf04ecf5248a179b010bc435afa2`。
[PR #961](https://github.com/fallrising/newclear/pull/961) 已於 `2026-11-02T10:43:52Z` 正常合併；merge commit：`619d1cd88c0beeaa3486301642613960fc201ff8`。
已核對來源 head `d0aa94381416624d13a5842c1b846c7f8c35bc7e` 未變動，使用 expected head SHA 合併，沒有 force、直接推 main 或繞過檢查。

合併前 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/41426986639) 與 [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/41426986614) 均為 success；沒有 review submission 或未解決 review thread，不等於完成獨立安全審查。
已回讀 merged=true、實際合併時間、主線 SHA，以及主線 [SDD](../SDD.md) blob `8f05bf449f102fd595a2f1ace878cd568af350f3`，與已驗證版本一致。
本收尾按根 AGENTS 的結束條件只修改任務板；五列 end 記文件 PR #961 的實際合併時間，不記收尾 PR 的時間。

[HANDOFF](../HANDOFF.md)、[SUCCESS](../../SUCCESS.md)、SDD 及元件 AGENTS 中的「本輪不合併／Draft-only」是初次交付時點紀錄；只就這個文件里程碑，由上述 owner 追加授權及本合併紀錄取代。
文件完成不代表產品完成：`mainline: incomplete`、`usable_tag: none`，AC-101～107 未實作／未執行；ADR 的 Proposed 不因合併而變為 Approved。沒有啟動 M1／M2、真憑證操作、release 或 deploy。
