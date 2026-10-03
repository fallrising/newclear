# Signal Hub — STATUS

本檔是本專案唯一的進度權威。日期：2026-10-03。

## 目前狀態

**M2 事件看板與來源新鮮度已實作；尚未合併、部署或接入真實生產者。** M2 以 M1 PR #199 的 `443df55798cfdaacd830ef21c01a40e2be087412` 為基準，保留獨立 stacked PR。M0 #198、M1 #199 與本次 M2 的合併／owner 驗收是分開的決定。

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| M0 contracts／M1 runtime | passed | 保留 schemas、fixtures、WAL、角色授權、查詢、去重與 Alertmanager 測試 |
| M2 唯讀 React 看板 | implemented | 時間線、URL 篩選、分頁、詳情／關聯鏈、來源狀態；Go embed 單一 binary |
| M2 source freshness | passed | 認證來源歸屬、duplicate 刷新、never／fresh／late／silent、silent／recovered 原子事件、重啟／migration |
| AC-40 合成查詢效能 | passed | 3 萬筆事件，9 種第一頁查詢各回 100 筆；本機約 0.37–1.05 ms |
| 獨立模型 review | accepted | gpt-6-astra 唯讀審查 M2，獨立執行 store／HTTP／auth／CLI／embed 測試 |
| Browser acceptance | passed | 5 個真實 Go／Chromium 測試；桌面與手機截圖目視確認，修正手機水平溢出 |
| root CI | 已接線 | Go race／契約／HTTP smoke、前端 types／unit／重建產物、Playwright；遠端結果以 PR checks 為準 |
| owner acceptance／合併 | pending | 模型審查與測試不等於 owner 驗收 |
| M3–M6 | not started | 指標、投遞、封存與生產環境 |

## 交付證據

- 環境：Linux amd64、Go 1.26.8、Node 24.19.0、Python 3.12。Go、npm 與 Python 驗證依賴均固定；前端正式產物隨原始碼提交。
- `go test -race -count=1 ./...`、`go vet ./...` 與 binary build 全數通過（8 packages）。來源測試涵蓋閾值、極大 interval、時鐘倒退、重複／衝突、交易 rollback、並行、重啟、設定變更、M1 attribution 與內部事件 identity 衝突。
- 本地工作區為 GitHub API 固定 SHA 快照，本機 build 加 `-buildvcs=false`；CI 使用 checkout，保留 VCS stamping。
- `npm ci`、`npm run format:check`、7 個前端邏輯測試、TypeScript 與 Vite 正式版 build 通過。CI 額外檢查重建 dist 與已提交版本一致。
- `python contracts/check.py`：6 schemas、61 正反 fixtures、15 webhook vectors、5 canonical vectors、strict JSON 與 OpenAPI 全部通過。
- 真正 binary 的 `scripts/e2e_smoke.py`：34 個 HTTP 回應符合 OpenAPI，包含來源角色隔離／分頁／新鮮度、原件不變、SQLite 外部鎖 503／重試、Alertmanager 及 SIGKILL 後 WAL 恢復。
- `TestQueryPerformance30K` 以一筆 fixture transaction 建立 3 萬筆合成事件，量測 public store query；這是本機第一頁讀取成本，並非網路／瀏覽器延遲或生產容量保證。
- 獨立 reviewer 未發現 high／medium 問題；審查範圍包括來源交易／權限、cursor、token 記憶體生命週期、URL 篩選、安全連結與 CSP。
- Playwright 1.63.0／Chromium 153.0.8010.12，以非 root UID、Chromium sandbox 啟用執行 5/5 通過。涵蓋 401／403、105 筆分頁、URL 歷史／重開、token 不落地、raw JSON／危險連結、來源沉默／恢復及 390px 手機頁面；桌面／手機截圖已目視檢查。
- 遠端 Ubuntu 24.04 CI 使用 runner 預裝 Chrome，版本記在 job log；保留 Chromium sandbox，不調整 AppArmor 政策。本機固定版 Chromium 的驗證結果如上。
- 固定程式版本以本次 PR head SHA 為準，避免在檔內引用自身 commit。

## 限制與下一步

- [Quickstart](quickstart.md) 提供建置、token／設定、看板、HTTP 與 browser 驗證。來源完整語義見 [source freshness](source-freshness.md)。
- M1 舊事件沒有認證來源名稱；升級保留事件，但來源先為 never，首次合法上報（含相同事件重送）後才更新。無 expected_interval 明確顯示未啟用檢查，不宣稱來源健康。
- readyz 只檢查 DB 可用性；未驗證真實磁碟耗盡、實體斷電、tailnet ACL、非 root 部署與持續運作。設定仍為 JSON 子集，沒有熱重載。
- 未實作 retention cleanup、封存、一般 YAML loader、規則／指標與投遞；非空 rules／subscriptions 仍拒絕啟動。
- 下一個最小切片為 M3 規則與指標；本次停止在 M2 Draft PR 與驗證證據，不延伸部署。
