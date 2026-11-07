# 部署後入口與唯讀命令 probe

`tools/live_probe.py` 是 Python 3.11 標準庫工具，使用 [部署 bundle](deployment-bundle.md) 的獨立 `bot.json`。預設只讀；沒有自動部署、安裝、改 Access policy 或啟用排程。

```sh
python3 platform/cloud-lab/tools/live_probe.py \
  --config /private/operator/bundle/bot.json \
  --evidence /private/operator/new-evidence
```

依序匿名讀取 `/`、`/styles.css`、`/dashboard.mjs`、`/api/bootstrap`、`/api/commands`，要求401／403或redirect；然後以精確 HMAC 與可選 Access service headers 讀 bootstrap、核對固定 workspace/resource/recipe，再讀 command list。只把拒絕／redirect 視為本次入口測量，**不代表已證明 human Access、所有替代入口或整個部署安全**。工具不追redirect、不採用環境 HTTP proxy、不記錄回應頁面、URL、headers、scope或secret值。

每次網路操作 timeout5秒，JSON上限32KiB；HTTPS使用標準憑證驗證。`--allow-loopback-http` 僅允許明確數字loopback測試，不可用於真實遠端。

## 明確提交一次固定檢查

經批准的真實唯讀驗收可使用：

```sh
python3 platform/cloud-lab/tools/live_probe.py \
  --config /private/operator/bundle/bot.json \
  --evidence /private/operator/new-run-evidence \
  --submit-readonly --wait-seconds 120
```

這個flag會建立一個健康檢查命令（控制面寫入），不代表允許其他操作。必須先通過匿名與authenticated scope檢查；只送固定node-health、timeout10秒、output16384 bytes。送出前以0600保存精確 `submission.json` 與digest，對檔案及其目錄項目執行fsync；落盤失敗時不送出。最多3次傳輸重試共用同一bytes/key/deadline，不新建替代命令。runner須另行在已選定節點啟動，probe不會代啟。

結果未確認時，用原private evidence恢復：

```sh
python3 platform/cloud-lab/tools/live_probe.py \
  --config /private/operator/bundle/bot.json \
  --resume /private/operator/existing-run-evidence \
  --submit-readonly --wait-seconds 120
```

resume驗context與request digest，不能刷新期限。若原grant過期，先保留證據，由operator對帳；不要改命令／刪journal以便重跑。每次resume另寫新的probe報告，保留原報告。

`accepted`只是durable ACK；`unknown`／`unconfirmed`／`unverified`不算執行驗收成功。`validated`需要同一命令的終態、validator passed、未過期的healthy或unhealthy觀測。**unhealthy仍可代表成功取得不健康觀測**。等待有界，工具不無限poll。異常capabilities、command ID或巢狀result／validation格式會記錄失敗，不當作已驗證結果。

## 私人檔案與證據

config須owner-owned、不可group/world讀寫、regular file／單hardlink、不得有symlink祖先。新evidence目錄排他建立、0700，內容0600，不允許Git checkout內路徑；resume不覆蓋先前證據。所有祖先以不跟隨symlink的directory descriptor讀取，FIFO／device拒絕。

`probe.json`只保存有限check名稱／code／HTTP status、readiness與execution分類；CLI只列固定摘要。`submission.json`包含私有resource reference，整個evidence仍須留在私人持久位置。這些資料不是可丟棄cache。

退出碼：0代表本次要求的只讀checks通過，或明確提交時執行已validated；1代表未通過／未確認；2代表設定或evidence問題。報告固定保留 human_access_verified、mobile_verified、backup_restore_verified=false；此工具不能代替上述人工／環境驗收。
