# 常態 runner 服務契約 — SR01–04

本輪實作獨立服務運行政策與啟動授權核對。沿用 Python 3.11 標準庫、原 runner 身分與 journal；不新增 Worker 權限或授權端點。真人／bot 的短期提交 grant 與 runner 的 claim／report／reconcile grant 已分開，本輪不重建身分系統。

| AC | 可驗收行為 |
| --- | --- |
| SR-01 | opt-in `--service-policy` 僅接受有界、owner 私有的嚴格 JSON；綁定載入 config digest，與 once／stop-at／inspection 模式互斥；缺失或漂移在 claim／journal 開啟之前拒絕 |
| SR-02 | 啟動先作一次既有 authenticated self 查詢；實際 HMAC／runner grant 與政策內 service_until／Access 期限取最小值。所有重啟使用同一絕對期限，牆鐘倒退及查詢耗時不得延長 monotonic 上限；不自動續權 |
| SR-03 | 截止後不再 claim；若 claim 或 journal commit 跨過期限，不開始 collector，保留 unknown 與既有回報／對帳語義。401／403停止，運行中的暫時傳輸錯誤有界退避；SIGTERM／重啟維持原 journal，已完成原樣重報，未知不重採集 |
| SR-04 | 合成 unit／實際本機 HTTP＋子程序恢復驗證、完整回歸、獨立審查與文件。公開證據區分實作與尚未啟用的 live 常態服務 |

## 服務政策

`cloudlab.runner-service.v1` 四個欄位：`schema_version`、`config_sha256`（既有 canonical JSON 的 SHA256，不是原始檔案 digest）、`service_until`、`access_expires_at`。兩個時間都是明確的 UTC RFC3339 絕對時間。政策檔為 owner 的 0600 regular single-link file，最多32KiB，不接受未知欄位、符號連結或重複 key。config 沿用同樣私人檔案檢查，須有 Access service token 設定。

Access 到期值由 operator 從已核對的管理來源填入，**不是 self 端點讀到的期限**；digest 將政策綁到含該 token 的完整 config。政策不授予任何雲端權限。撤銷／縮短在下一次 claim 由伺服器拒絕；本機窗口只會維持或縮短，不因遠端續期自行延長。服務先停、重新採集授權、明確更新私人政策、重新啟動；不熱載入 credential 或政策。

啟動成功不代表未來一直可用，也不驗證真人 session／Access policy。沒有通用 shell、Cron、Queues、輪替 secret、自動續權、修改 user unit／linger 或付費方案。本輪不改 live Worker／grant／token／服務。

## 驗證與交付

先寫失敗案例再實作。既有 stop-at CLI 行為相容。新增服務模式以真實本機 HTTP／子程序驗證 startup self→claim、期限停止、拒絕啟動與保留 journal 後恢復；資料均為合成。完整主線 AC06–08 保持 pending；下一輪才準備有具體期限、輪詢頻率與用量估算的常態啟用方案。

## 使用及恢復

先固定已核對的 runner config 與私人政策。政策內容範例（合成日期／digest，不能直接當作真實授權）：

```json
{
  "schema_version": "cloudlab.runner-service.v1",
  "config_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "service_until": "2030-01-02T00:00:00Z",
  "access_expires_at": "2030-01-03T00:00:00Z"
}
```

Digest 應由同版 runner 的 `read_inspection_config(config_path)._loaded_sha256` 取得並只保存於私人政策；此值使用 `encode(strict_json(config_bytes))` 的 SHA256，格式化空白不影響結果，任何設定值改變均會拒絕原政策。政策必須由 operator 明確選擇期限、檢查目標及 Access 來源；不得直接拿文件日期或未知 Access 期限填入。

```sh
python3 runner.py --config /private/runner.json --service-policy /private/service-policy.json --poll-seconds 30
```

可搭配既有 `--observation-socket /private/resident.sock`。服務模板見 [service unit](../adapters/node-health/cloud-lab-runner-service.service.example)，既有 [stop-at unit](../adapters/node-health/cloud-lab-runner.service.example) 保留。模板不是已安裝服務；確認私人路徑與政策後先作 `systemd-analyze --user verify`。不修改 linger，不使用 Restart=always，正常期限停止及授權錯誤不得由 systemd 重啟迴圈繞過。

啟動只做一次 `/api/authorization/self`，沒有管理 token，也不讀 human／bot grant。Self 驗證身分、scope 與期限，**不包含 capability 清單**；是否能 claim／report 仍由各 Worker route 的 grant 檢查決定。啟動查詢逾時、拒絕或非預期回應直接退出，不開 journal，不自動重試；lock 檔可能已建立且保留。運行中的 claim／report 才沿用30～120秒退避，成功重設；401／403與協定／journal錯誤退出。每次程序重啟多一次 self 請求；沒有增加每輪 self 查詢。

服務截止是停止新採集／新 cycle 的界線，不是強殺正在進行的固定 collector 或 HTTP。若 claim／journal commit 跨過截止或收到停止訊號，尚未起跑的工作記 unknown，按原協定嘗試回報；若回報因到期被拒絕，保留 journal 供之後有效的 reconcile 身分對帳。已開始的採集可完成並保存結果；不宣稱到期即已停止所有 I/O。一般時間倒退不能延長同一程序的 monotonic 窗口；跨主機重開機不承諾可信時鐘，須保有正確系統時間及伺服器檢查。

續期與恢復順序：停止服務 → 保留 journal／lock → 重新採集現況及對帳在途命令 → 明確批准並執行必要的原 scope 續期 → 重建 config-bound 私人政策 → 重新啟動並觀測。新程序仍檢查所有絕對期限；遠端授權變長不會讓已啟動程序延長。輪替／修改 config 必須停止後進行，沒有熱載入。Rollback 使用原 journal 與上一版 runner／stop-at unit，不能並行執行或清空 journal。

本輪實際結果與限制見[SR本機證據](evidence/m1-service-runner.md)。
