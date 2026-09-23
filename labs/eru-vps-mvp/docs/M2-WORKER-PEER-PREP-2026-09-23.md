# ERU-008：worker-2／3 目標核對準備

更新：2026-09-23 17:55 UTC。**ERU-008 進行中**。現有 24 小時觀測在 worker-2／3 各有一個 run-owned nginx；到期前不可把它們當作空 worker 清理重裝。[觀測待辦](TODO-SOAK-2026-09-23.md)。

本輪擴充了唯讀 `rebuild-node` 計畫的目標核對。`worker_scope` 現在從固定四台 inventory 取得所選 worker 身分，核對該 alias 上已安裝的 `eru-agent.service` 只宣告相同 `ERU_HOSTNAME`，同時保留六檔／三個狀態根的 ownership、hash、link、mount 稽核。計畫對 worker-2／3 也讀取 **所選 host** 的 tasks、containers、metadata 與資源使用量；若不空，列出具體 blocker。這避免因固定 worker-4 常數而誤讀別台空狀態。

本機 178 項測試通過，包含 02／03／04 的身分一致與不一致、02 的 orphan task／資源使用量、兩個 peer 目標均保持不可執行。B→VPS **僅使用 SSH aliases** 做了兩份唯讀計畫，沒有 execute：

| 目標 | 私有計畫 ID | 唯讀結果 |
| --- | --- | --- |
| worker-2／`ckc-disposable-02` | `20260923T175431Z-4dbc5a20` | scope 身分與 ownership 通過；仍有本次 nginx，計畫 `executable=false` |
| worker-3／`ckc-disposable-03` | `20260923T175508Z-9ab05efd` | scope 身分與 ownership 通過；仍有本次 nginx，計畫 `executable=false` |

兩份計畫都列出目標非空、缺少新的 health／canary evidence，及 peer 執行器／恢復／守護能力尚未啟用。它們是已保存的**唯讀歷史計畫**，日後不可補欄位或拿舊 hash 執行。原始內容在 `private/operations/plans/`，命令輸出在 `private/diagnostics/`，不可提交。

接續順序：先完成 ERU-002 的 evidence 和 ERU-003 的精確清理；再為所選空 worker 設計不落在該目標上的 run-owned HTTP 守護及對應恢復計畫。用本機故障／回覆遺失測試驗證 selector、fence、quarantine、install、resume 和 revision 歸屬，才考慮開放 peer execute。逐台以新 plan／hash、持續 HTTP、配額與其他節點保留驗收；不重播本輪 review-only 計畫。
