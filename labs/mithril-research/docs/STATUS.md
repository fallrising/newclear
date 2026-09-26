# Mithril research status

更新：2026-09-27。狀態權威：本檔；研究基線：`../upstream.lock.json`。

## 目前結論

M0 靜態研究完成；M1–M3 尚未驗證。研究只支持「進行隔離實驗」，不支持 production 採用判定。當前交付經 branch／PR 審查；本檔不提前宣告 main 已合併。

## 固定任務清單

| ID | 工作 | 依賴 | 狀態 | 證據／下一步 |
| --- | --- | --- | --- | --- |
| MR-001 | 倉庫政策、定位與 upstream pin | 無 | DONE | root policies、SOURCES、lock |
| MR-002 | 文件／關鍵程式碼研究與初判 | MR-001 | DONE | RESEARCH；五個 source 模組有明示範圍 |
| MR-003 | 實驗 SDD、範例與接手邊界 | MR-002 | DONE | SDD、quickstart、loopback conf |
| MR-004 | Linux fixture、digest pin、build/native checks、精確清理 | MR-003 | BLOCKED_ENV | 本輪無 Rust/Docker/Redis；下一輪最先執行 |
| MR-005 | 核心相容性與 SDK 測試 | MR-004 | TODO | C01–C05、C11–C12 |
| MR-006 | migration/failover／ambiguous operations | MR-005 | TODO | C06–C08、C13 |
| MR-007 | cache、backpressure 與資源回收 | MR-005 | TODO | C09–C11；不把低 memory 單次快照當有界性證明 |
| MR-008 | 公平效能複現與決策 ADR | MR-006、MR-007 | TODO | SLO 先定義；M3 報告 |

共 8 項：3 DONE、1 BLOCKED_ENV、4 TODO；未完成共 5 項。DONE 只指研究交付範圍，不指軟體測試通過。計數只由本表產生，避免多份 backlog 漂移。

## 接續資訊

Repository：`https://github.com/fallrising/newclear`；相對路徑：`labs/mithril-research/`；SSH remote：`git@github.com:fallrising/newclear.git`。本機 checkout 絕對路徑由執行環境決定，不能假造既有 `/workspace`。

接手 agent 先讀 [AGENTS](../AGENTS.md) 指定的完整文件、查 main/PR 狀態，再執行 MR-004。M1 成功後在 [VALIDATION](VALIDATION.md) 新增 run ID、commit/image/binary 身分、退出碼、log 位置及限制，再改任務狀態。

## 不可悄悄擴大的範圍

不接 production／現有 VPS；不修改 `kernel`、`snail`、Eru 或知識庫；不自動 fork、vendor 或改 upstream。新資料若推翻既有研究，保留舊基線並說明變更原因，不直接改成「一直如此」。
