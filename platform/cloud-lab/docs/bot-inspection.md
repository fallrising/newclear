# Bot租期與額度唯讀查詢 — BI01–04

Owner繼續開發。已啟用bot目前需要一個不消耗call、不呼叫HTTP的日常狀態入口。本輪新增獨立可信operator CLI，讀原config／policy／SQLite及既有FLOCK，顯示本機期限、額度與待對帳請求；不改MCP工具catalog、不續權或替換已啟用候選。

| AC | 驗收 |
| --- | --- |
| BI-01 | 只開啟既有私有檔案及唯讀SQLite；shared nonblocking FLOCK與writer互斥；缺失、不安全路徑、hot journal/WAL、損壞拒絕，不能建立／遷移／初始化／修復 |
| BI-02 | 完整config／policy digest綁定、active/not_started/expired/clock_rollback、calls與新ID餘額、兩類本機准入與等待秒數；舊ID不受新ID額度阻擋，時間狀態優先 |
| BI-03 | 原歷史含ACK與未確認請求，另外顯示已預留但無payload的ID；最多20個待對帳ID，標示截斷；ACK不代表遠端完成。最多10000筆request及16MiB DB，超出拒絕 |
| BI-04 | RGR、實際CLI／SQLite／FLOCK／byte保全、配額與時鐘／到期／續租測試、獨立審查及正常Git交付；原live狀態只讀驗證，不安裝／提交／續權 |

輸出schema cloudlab.bot-inspection.v1；明示remote_authorization=not_checked，authority_until只來自保存policy。沒有可用的本機准入不代表遠端已失效，有本機餘額也不是可執行承諾。本入口不記錄新的clock high-water；實際准入仍由既有bridge持久時鐘檢查負責，不用此觀測替代續權或驗收。

所有錯誤只回固定code，不含憑證、私人path／URL／payload。請求ID僅供同ID對帳，無自動重試／POST／任意shell。超過觀測上限或同時writer持鎖顯示錯誤，不刪除／重建state。僅Python標準庫，無新依賴／付費；HL API500與模型自然語言整合維持獨立未完成項。

## 使用與判讀

```sh
python3 platform/cloud-lab/tools/bot_inspect.py \
  --config /private/operator/bot.json \
  --state-dir /private/operator/bot-state \
  --policy /private/operator/policy.json
```

以上路徑為synthetic示例；使用原已初始化state，不能另建空目錄來重置額度。成功exit0只表示本機快照讀取成功，包含expired／not_started／clock_rollback等非可用狀態；讀取／安全／損壞錯誤exit2及固定code。既有MCP check/status維持原工具數量；這個CLI不暴露給模型。

`quota`分別列calls及new_requests的used/limit/remaining；剩餘數即使期限過了也會保留，能否嘗試呼叫看`local_admission`。existing_request指已保存或已預留的同ID，new_request指真正新ID；沒有繞過原bridge檢查。等待秒數向上取整，如果等完已到期則POLICY_WINDOW_TOO_SHORT、wait_seconds=null。remote_authorization及remote_results永遠not_checked，authority_until為saved_policy，不會查CF／刷新self／推論健康。

`requests.acked`只表示本機保存command ID，並非任務成功；`unconfirmed`指payload已保存但沒有ACK。`reserved_without_payload`指先扣額度後、尚未完成payload保存，可能是bootstrap失敗或程序中斷。pending最多20個上述ID，依ID排序且標示是否截斷；不顯示scope／credential／URL／payload／command ID。原歷史跨續租保留，不把歷史request數當成目前新ID用量。

Linux依賴既有0700state、0600lock／DB、no-follow逐層路徑、既有shared FLOCK及SQLite mode=ro/immutable；任何journal/WAL/SHM都拒絕，不做recovery。最多16MiB DB、10000requests、24reservations、200萬SQLite VM instructions；超出界線拒絕而非猜測。檔案讀取可能更新filesystem atime；不承諾kernel I/O總deadline。合作writer須沿用原FLOCK；同OS使用者直接改DB／刪檔／繞鎖不屬安全隔離。CLI不更新high-water，快照不能防止日後時鐘倒退；原bridge准入仍負責持久時鐘記錄。
