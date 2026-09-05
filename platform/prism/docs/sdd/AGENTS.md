# AGENTS.md

本文件適用於所有實作 Prism 的 coding agent。子目錄若有更嚴格的 `AGENTS.md`，以更嚴格者為準。

## Mission

依 `12-IMPLEMENTATION-PHASES.md` 的 task 順序，完成最小、可驗證、可回滾的變更。一次一個 task，不要自行擴張範圍。

## Required workflow

1. 開工前讀：`AGENTS.md`、`00`、`01`、`02`、`03`（設計主張），再加 `14`、`15`、`23`（逐字契約），以及本 task 表格中點名的專章。
2. 重述 task scope、依賴、允許修改路徑、驗收標準。
3. 有疑問且答案會改變設計時，提出 blocking question；其餘自行判斷並記錄假設。
4. 只修改該 task 的允許路徑，保留使用者既有變更。
5. 執行驗收命令，記錄實際 command 與輸出。
6. 依 `12` 末尾的格式輸出完成報告。

## 架構紀律（違反即為設計退化，不是實作細節）

- `pkg/**` 不得 import `internal/**` 或 `drivers/**`。
- `drivers/**` 不得 import `internal/**`，也不得互相 import。
- `internal/compat/**` 不得 import `drivers/**`。
- 取得後端的唯一途徑是 `spi.Backend` 介面；任何對具體驅動的型別斷言（除 `pkg/spi` 定義的可選介面外）都是錯誤。
- 業務語義只能在 `internal/**`；驅動只做存儲與翻譯，不做業務判斷。
- 新增功能時先問：「這在最弱的驅動（`memory`）上如何運作？」答不出來就是設計沒完成。

## 授權紀律

- 只依賴 Apache-2.0 / MIT / BSD / MPL-2.0 的程式碼。
- **禁止 import `grafana/loki`、`grafana/tempo`、`grafana/grafana` 或任何 AGPL 專案。**
- LogQL 相關實作必須是 clean-room（見 ADR-004）：不得閱讀 Loki 原始碼，只依公開 API 文件與實測回應。
- 新增任何 dependency 必須在 PR 說明必要性、授權與供應鏈風險。

## Engineering rules

- 小步、單一目的、可讀、可測試；避免無關 refactor。
- 時間轉換一律經 `pkg/utm/time.go`（規格見 `14` §1）；程式碼中不得出現裸的 `/1000`、`*1e6`、`* time.Millisecond` 換算遙測時間戳。
- `pkg/utm` 與 `pkg/spi` 的公開識別字以 `14-SPI-GO-REFERENCE.md` 為準，不得增刪；變更需 ADR。
- 新增設定項時同步更新五處：結構體、預設值、`--config-check`、`11` §1 範例、`deploy/prismd.yaml`（`23` §2.6）。
- 新增自身指標前先在 `20-SELF-TELEMETRY-REGISTRY.md` 登記並評估基數（`20` §10）。
- 依賴只能從 `23` §2.9 的白名單選；新增需 PR 說明必要性、授權、維護狀態。
- 所有 I/O 路徑帶 `context.Context` 並尊重取消；長迴圈中定期檢查 `ctx.Err()`。
- 所有迭代器必須可 `Close()`，呼叫端必須 `defer Close()`。
- 遙測資料路徑禁止無界緩衝、無界併發、無界結果集。任何 `append` 到可能無限增長的 slice 都要有上限。
- 錯誤一律包成 `spi.Error` 或 wrap 後保留分類；不得 `errors.New` 掩蓋原因。
- 外部輸入（OTLP、remote_write、LogQL、規則 YAML）必須驗證，且有 fuzz 測試。
- 行為改變需測試；bug fix 先補回歸測試，並把觸發查詢加入 `test/differential/corpus`。
- 併發程式碼必須通過 `-race`；長駐 goroutine 必須通過 `goleak`。

## 可觀測性紀律

- 每個「平台動了使用者資料」的動作（截斷、改名、丟棄、夾時間）都必須遞增對應指標。使用者有權知道。
- 每個查詢必須記錄走了 pushdown 還是 fallback。
- 新增的錯誤路徑必須有指標或日誌，不得靜默失敗。

## Security rules

- 日誌、錯誤訊息、API 回應中不得出現 API key、密碼、token、webhook URL 的憑證部分。
- 憑證欄位一律支援 `_file` 變體，載入後包成 `secret.String`。
- 所有 store 方法簽章必須帶 tenant；不得存在「不帶 tenant 的查詢」。
- 使用者輸入的 matcher / 標籤不得覆寫 `__` 前綴的系統標籤。檢查必須在**解析後的 matcher 集合**上做，不可只做字串比對（`21` §T1）。
- 憑證欄位一律用 `internal/secret` 的 `secret.String`；新增含憑證的型別時，同步加入 `21` §T2 的序列化 golden test。
- 動到認證、授權、租戶隔離、憑證處理的 task，完成後必須跑 `test/security`（`10` §6）。
- 不執行來源不明的安裝腳本；依 lockfile / pinned version 安裝。
- 發現既有程式碼有跨租戶洩漏風險時，停止當前 task 並回報。

## Git rules

- 不直接 push `main`；每個 task 一個 branch。
- 不改寫共享 history，不 force push。
- Commit message 引用 task id（如 `P1-08: implement Prometheus query endpoints`）。
- 不修改 `.github/workflows/**`、`pkg/spi/**` 的公開介面，除非 task 明確授權；`pkg/spi` 的介面變更需要 ADR。

## Completion response

輸出：完成內容、changed files、實際執行的 commands 與輸出、acceptance mapping、未完成項與理由、風險與 open questions。

**不得宣稱未實際執行過的驗證。** 測試沒跑就說沒跑；跑了失敗就貼失敗輸出。
