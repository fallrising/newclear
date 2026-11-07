# Iris lab 任務板

## T-0402 — M0 研究與文件先行

範圍：[SDD](../../SDD.md) AC-01–05。後續 runtime AC-101–106 不在本卡交付範圍。主文件 [PR #610](https://github.com/fallrising/newclear/pull/610) 已於 2026-10-24T15:32:23Z 合併；merge commit `b86ebc346b2c20f99e51e032b4b818338a88383d`。本次 board-only 交付將五條文件任務結案，end 使用主文件實際合併時間。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0402-01 | 用途、階段與固定來源規格 | AC-01 | done | 2026-10-24T15:21:05Z | 2026-10-24T15:32:23Z | 2026-10-24T15:33:08Z |
| T-0402-02 | OS／backend／模型與依賴矩陣 | AC-02 | done | 2026-10-24T15:21:05Z | 2026-10-24T15:32:23Z | 2026-10-24T15:33:08Z |
| T-0402-03 | 介面／資料／失敗契約與實機驗收計畫 | AC-03 | done | 2026-10-24T15:21:05Z | 2026-10-24T15:32:23Z | 2026-10-24T15:33:08Z |
| T-0402-04 | 教學研究、來源及限制 | AC-04 | done | 2026-10-24T15:21:05Z | 2026-10-24T15:32:23Z | 2026-10-24T15:33:08Z |
| T-0402-05 | 文件檢查、獨立審查與 PR 交付 | AC-05 | done | 2026-10-24T15:21:05Z | 2026-10-24T15:32:23Z | 2026-10-24T15:33:08Z |

M1／M2 是 SDD 的後續規劃，尚未認領為實作任務；沒有模型下載、建置或 runtime 驗收結果。

驗證：主文件 17 個遠端 blob 與本地已驗內容一致；合併 tree 與候選 tree 相同。必要 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40107379881) 與 [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/40107379896) 均通過；文件獨立審查 PASS。這些證據只涵蓋 M0，完整主線仍 incomplete、usable tag 為 none。
