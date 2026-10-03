# Edge Ops 開發約定

## 範圍

本檔只適用於 `platform/edge-ops/`。先讀 repository 的 README、PORTFOLIO、docs/taxonomy.md、docs/portfolio-doc-tiers.md、docs/specs/monorepo-ci.md，再完整閱讀本專案 SDD、docs/sdd/ 下全部文件、docs/STATUS.md 與本次選定契約。

目前只有 M0 契約層程式碼（`contracts/`、`backend/`、`agent/`，見 docs/STATUS.md）。看到下一個 milestone，不代表取得實作、部署、安裝、Terraform apply、重啟或主機權限變更授權。使用者只要求設計時，停在設計 PR。

`contracts/` 由整合者維護：改變 wire、簽署位元組或上限時，同一 PR 內更新 TS（`backend/src/domain/contract/`）、Go（`agent/internal/contract/`）、`contracts/vectors/`（`npm run vectors`）與 `contracts/README.md`，兩邊測試都要通過。

## 不變量

1. 預設監控-only；不能由遠端設定把 collector 升級成 root 執行器。不得提供通用 WebSSH、隱藏 shell、任意路徑讀取、Docker socket 掛載或無條件 sudo。
2. 主機變更必須有單一 host authority。不得改寫 dim-gate、agent-platform、fleet 或 private kernel 的生命週期責任來湊通功能。
3. 不將真實 IP、主機名稱、帳號、token、SSH key、日誌或私有配置提交到此公開 repository。範例使用 `example.invalid` 與合成 ID。
4. 契約先於平行實作。M0 產生 OpenAPI、JSON Schema、TS/Go 相容 fixtures 後才分派三工作線。禁止各線自行發明 job state、metrics units 或 enrollment 身分模型。
5. API 及 Agent 版本需支援相容矩陣；新增特權能力必須 fail-closed。沒有真實驗收不得宣稱跨平台或 production-ready。
6. 不宣稱 exactly-once shell execution；不把 lease 過期當成程序停止；不把 UI 顯示 cancelled 當成主機已停止。

## 交付

以 project-scoped branch／worktree 工作，PR 僅改本目錄及必要根索引／專屬 CI。不要重寫根 `.team/PLAN.md` 的其他 program。本專案以 `docs/STATUS.md` 作唯一進度權威，SDD 保存契約而非易過期的實作進度。

每個 milestone 提交：固定 commit、已執行測試與環境、未執行原因、風險、待核准項目、下一個最小切片。自行審查不得標成獨立 reviewer 已通過。accepted、merged、deployed、live-verified 是不同狀態。

首個 executable 切片才加入根 `.github/workflows/edge-ops-ci.yml`：path-scoped、contents: read、timeout、concurrency、checkout 不保留 credentials、第三方 actions 固定經核對 SHA；預設不 deploy、不發布 release、不讀 production secrets。
