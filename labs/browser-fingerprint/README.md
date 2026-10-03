# Daylight · 瀏覽器設備觀測實驗

> 有界測試 lab；投入與文件檔位尚未分級。見 [Portfolio](../../PORTFOLIO.md) 與[文件政策](../../docs/portfolio-doc-tiers.md)。

繁體中文任務工作台，使用原生 HTML、CSS、JavaScript 與 Go 標準函式庫。Go 提供靜態頁面、記憶體 mock CRUD API，以及本機 JSONL 設備與操作觀測。用途是比較不同瀏覽器／computer-use 的可觀測訊號；指紋無法證明個人身分或真人／AI。

## 執行與驗證

需要 Go 1.22+；分析日誌另需 Node.js 18+。先進入本目錄，所有命令均在此執行：

```sh
cd labs/browser-fingerprint
go run .
```

開啟 <http://127.0.0.1:4173/?sample=computer-use-iab>。`sample` 是自填的實驗標記，不代表已驗證的操作來源。按「開始操作教學」，依序新增 → 編輯 → 完成 → 搜尋 → 刪除任務。介面核對本輪事件寫入結果；記錄不完整時，成功的 CRUD 仍會保留並顯示提示。

```sh
go test ./...
go vet ./...
go build -o .runtime/daylight-server.exe .
```

建置範例採 Windows 檔名；其他平台可改為 `.runtime/daylight-server`。`package.json` 提供相同的 `start`、`test`、`build` 命令，需要 Go 在 PATH；服務本身不需 npm 或 Node.js。

| 環境變數 | 預設 | 用途 |
| --- | --- | --- |
| `PORT` | `4173` | 本機 loopback HTTP 連接埠 |
| `LOG_DIR` | `.runtime/observations` | 相對於啟動目錄的日誌路徑，必須位於 `public` 之外 |
| `DEMO_RUN_ID` | UTC 啟動時間 | 本輪實驗標記；同一目錄的日誌採 append |

Go 開發參考 [JetBrains Modern Go Guidelines](https://github.com/JetBrains/go-modern-guidelines)，以 CLI 的 `list --file-path` 依 `go.mod` 取得適用規則，再 `explain` 相關項目；即使工具鏈較新，仍維持 Go 1.22 相容性。

## Cloudflare Quick Tunnel

安裝 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 並加入 PATH。保持 Go 服務運作，在另一個終端執行；Go 的 `PORT` 與 tunnel URL 必須一致。

公開測試，持有網址的人均可存取：

```sh
cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate
```

私人測試，限制指定信箱：

```sh
cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate --allowed-mail your@example.com
```

訪客以允許的 email 收取並輸入一次性 PIN。可重複 `--allowed-mail`、以逗號分隔信箱，或使用 `*@example.com` 允許整個網域；需要支援此 flag 的版本與互動式瀏覽器。[官方私人 Quick Tunnel 說明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#restrict-access-by-email)

PowerShell 腳本預設私人模式；實際信箱只在執行時傳入：

```powershell
.\scripts\start-tunnel.ps1 -AllowedMail 'your@example.com'
.\scripts\start-tunnel.ps1 -AllowedMail 'alice@example.com', 'bob@example.com'
.\scripts\start-tunnel.ps1 -AllowedMail '*@example.com' -Port 4173
.\scripts\start-tunnel.ps1 -AllowedMail 'your@example.com' -WhatIf
.\scripts\start-tunnel.ps1 -Mode public
```

脚本優先使用 PATH 的 `cloudflared`，其次為自行放置的 `.runtime/cloudflared.exe`，也可指定 `-CloudflaredPath`。缺少 allowlist、舊版不支援 flag 或啟動失敗時會停止。腳本以前景方式執行，`Ctrl+C` 停止；不建立背景 PID 或日誌 pointer。

啟動後終端顯示臨時 `https://….trycloudflare.com` 網址；停止或重啟後舊網址失效，修改允許名單須重啟。**切換私人測試前先停止同一服務的既有公開 tunnel；新的私人網址不會撤銷另一個仍在運作的公開網址。** 本 lab 不含私人 PIN 登入的實測證據。

瀏覽器 HTTPS 在 Cloudflare edge 終止；本機 Go 記錄的是 cloudflared 到 origin 的 HTTP／TLS 資訊，不代表瀏覽器的原始 handshake，也沒有 JA3／JA4。[Origin 連線設定](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)

## API 與 mock 資料

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康狀態、Go runtime、`runId` |
| GET | `/api/tasks` | 任務清單 |
| POST | `/api/tasks` | 新增任務 |
| PATCH | `/api/tasks/:id` | 編輯內容或完成狀態 |
| DELETE | `/api/tasks/:id` | 刪除任務 |
| POST | `/api/fingerprint` | 寫入瀏覽器觀測，回傳摘要與 session |
| POST | `/api/events` | 寫入白名單操作事件 |

任務包含 `id`、`title`、`project`、`priority`、`completed`。名稱為 1–100 字元；專案為 `設計`／`開發`／`生活`，優先度為 `high`／`medium`／`low`。訪客共用記憶體資料，重啟回到六項示範任務。

## 記錄與分析

頁面載入會收集瀏覽器提供的資料，介面「設備觀測」可查看摘要：

- UA、UA Client Hints 與可用的高熵版本／架構資訊、平台、`webdriver`、PDF viewer、Plugin API、MIME types。
- CPU 執行緒數、回報記憶體、觸控、螢幕／視窗尺寸、色深、DPR、語言、時區、storage 與顯示偏好。
- WebGL 資訊與固定 Canvas 樣本摘要；操作事件、任務 ID、搜尋字數、相對時間、`isTrusted` 等訊號。
- 伺服器收到的時間、路徑、方法、狀態、耗時、連線來源與指定 headers。轉送欄位是未驗證的回報，標記 `forwardedHeadersTrusted: false`。

事件觀測不包含搜尋或表單文字；CRUD API 仍须接收任務內容。未收集帳戶資料、驗證 cookie、精確位置、media-device IDs、WebRTC local IP 或字型清單。

一般網頁無法完整列出瀏覽器擴充套件及其版本；`navigator.plugins` 可能僅回傳固定 PDF 相容項目，plugin 版本與擴充套件清單標為不可取得。[Plugin API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/plugins) UA 可能縮減，Windows UA-CH `platformVersion` 也不是精確 OS build。[Microsoft 版本說明](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11)

`webdriver`、事件與客戶端資料可受環境影響或被修改，不能單獨證明真人／AI。[webdriver](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver) `fingerprintId` 是選定設備欄位的實驗性摘要，排除 IP、viewport、cookie、session 與時間；不保證唯一或永久穩定。`daylight_session` cookie 關聯同一工作階段，採 `HttpOnly`、`SameSite=Lax`，HTTPS 轉送時加 `Secure`。

預設 `.runtime/observations` 中有 `requests.jsonl`、`fingerprints.jsonl`、`events.jsonl`，由 `runId`／`sessionId`／`fingerprintId`／`requestId` 關聯。伺服器拒絕將日誌放入 `public`（含 symlink 別名），API 沒有讀取日誌功能。預設日誌與分析結果位於 ignored `.runtime`；自訂路徑須自行排除版本控制，請勿提交實際樣本。

完成瀏覽器操作後執行：

```sh
node analyze-observations.cjs
node analyze-observations.cjs --log-dir .runtime/observations --sample computer-use-iab
node analyze-observations.cjs --sample manual-browser --operator "self-reported manual test"
node analyze-observations.cjs --help
```

目錄優先序為 `--log-dir` → `LOG_DIR` → 可選 `.runtime/active-log-dir.txt` → 本 lab 的 `.runtime/observations`。旗標／環境變數的相對路徑以執行目錄解析，pointer 的相對路徑以 lab 解析；分析工具要求實際日誌位於本 lab 內且在 `public` 外。

`--sample` 預設 `computer-use-iab`，須與頁面 `?sample=...` 相符。工具只關聯該樣本的同一 session／run，輸出設備摘要、教學與 CRUD 證據至所選目錄的 `analysis.json`；`--operator` 是自填註記，不能當成已驗證身分。這份來源匯入不含真實指紋、分析結果、截圖、允許信箱或有效 tunnel URL。
