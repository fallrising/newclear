# Signal Hub — STATUS

本檔是本專案唯一的進度權威。日期：2026-10-03。

## 目前狀態

**M1 本機 runtime 已實作並驗證，待 PR 審查；尚未合併、部署或接入真實生產者。** M1 以 M0 PR 的 `682cdb9c3eb0b831b1c2e56b27caa5546d68f0f5` 為基準，保留獨立的 stacked PR。

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| M0 schemas／OpenAPI／fixtures／vectors | passed | 6 schemas、61 正反 fixtures、15 簽章及5 canonical vectors；保留原檢查 |
| M1 event／auth／config | passed | strict JSON、JCS、16 KiB、來源 scope、owner／readonly、檔案 secret、JSON 設定子集 |
| M1 SQLite／query | passed | WAL／FULL、migration、commit 後成功、去重／衝突、批次、filter／cursor／related |
| M1 Alertmanager 本機轉換 | passed | 合成 firing 重送去重、resolved 新事件、逐項錯誤隔離；AC-06 |
| 獨立模型 review | accepted | gpt-6-astra 唯讀審查、獨立 race 與真實 HTTP 測試；只涵蓋本機 M1 |
| root CI | 已接線 | path-scoped Go／契約／HTTP smoke；遠端實際執行結果以 PR checks 為準 |
| owner acceptance／合併 | pending | 模型審查與測試不等於 owner 驗收 |
| M2–M6 | not started | 無 UI、指標、投遞、封存或生產環境 |

## 交付證據

- 環境：Linux amd64、Go 1.26.8、Python 3.12 隔離環境。Go 依賴由 go.mod／go.sum 固定；Python 契約依賴固定於 contracts/requirements.txt。
- 完整 Go 驗證：gofmt、`go test -race -count=1 ./...`、`go vet ./...`、`go build -trimpath`。7 packages、37個頂層 test（含多個子案例）通過。
- 本地工作區為 GitHub API 固定 SHA 快照，所以本機 build 另加 `-buildvcs=false`；CI 使用完整 checkout，正常保留 VCS stamping。此旗標不影響程式行為或測試。
- `python contracts/check.py` 通過原 M0 全套。event format parity 另含17組 URI／時間格式，由 Go 與 Python FormatChecker 核對。
- `python scripts/e2e_smoke.py --binary <binary>` 啟動真正 loopback process，27個 HTTP 回應逐一通過 OpenAPI schema；包括角色隔離、原件不變、批次、精確分頁、SQLite 外部鎖503／重試、Alertmanager 與 SIGKILL 後 WAL 重啟持久化。
- 獨立 reviewer 另執行 URI／year-zero 真實 HTTP 檢查，複核 NUL／Unicode 前綴、任意小數秒、UTC 邊界、clock skew、64層 JSON 與 adapter integer 修正；無剩餘 blocking findings。
- CI YAML 靜態檢查涵蓋 paths、contents:read、timeout、concurrency、固定 action SHA 與 checkout credentials 關閉；action SHA 已向上游核對。
- 本 commit 的程式與證據由其 PR head SHA 固定；不在檔內填入自身 commit 造成循環引用。

## 限制與下一步

- [Quickstart](quickstart.md) 提供本機建立 secret／設定、啟動、寫入、查詢與驗證方式；[runtime contract](runtime.md) 明訂 JSON 設定子集、4 MiB body 與64層 JSON 邊界。
- readyz 只檢查 DB 可用性；尚未驗證真實磁碟耗盡、實體斷電、tailnet ACL、非 root 部署與持續運作。SQLite lock／migration rollback／寫入失敗已有本機測試，不能推論為上述環境驗收。
- 尚無 retention cleanup、封存、來源新鮮度 evaluator、一般 YAML loader 或設定熱重載；M1 拒絕非空 rules／subscriptions，避免誤以為已生效。
- 下一個最小切片為 M2：時間線、事件詳情與關聯鏈 UI、來源新鮮度；另行指示後開始。M0／M1 的 PR 審查與合併維持獨立決定。
