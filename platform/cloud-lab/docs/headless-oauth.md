# 無桌面 Cloudflare MCP 授權操作

這是已實際完成的 Codex CLI 0.164.0／Cloudflare API MCP 操作紀錄。登入前先核對當前 `codex mcp login --help` 是否仍提供 `--no-browser` 與 `--scopes`；版本改變時重新核對，不能將這份紀錄當成所有 OAuth client 的通用介面。

## 標準流程

登入程序必須在**需要儲存 MCP 憑證的遠端機器**執行。以下 `lab-host` 是示意 SSH alias，請用 operator 私人紀錄中的實際值。

1. 在本機開互動 SSH：`ssh -t lab-host`。
2. 在該 SSH 終端執行下列命令；既有連線名稱為 `cloudflare-api`，URL 為 `https://mcp.cloudflare.com/mcp`。只要求本次工作需要的 scopes；下面是本輪 D1、Worker 與 Access 部署的完整清單。

   ```sh
   codex mcp login cloudflare-api --no-browser --scopes user:read,account:read,zone.read,dns.read,workers-routes.read,workers-scripts.metadata_read,access-app.read,access-policy.read,access-org.read,access-idp.read,offline_access,d1.read,d1.write,workers-scripts.read,workers-scripts.write,access-app.write,access-policy.write,access-service-token.read,access-service-token.write,access-audit-log.read
   ```

3. 用本機瀏覽器開啟**這次新印出的完整授權 URL**並同意授權。保留 SSH 程序，勿結束它或沿用之前的 URL。
4. 瀏覽器最後導向 loopback callback；此模式下頁面無法連線是預期現象。複製網址列的**完整 callback URL**，貼回同一個 SSH 終端的 `Callback URL (input hidden):` 提示後按 Enter。
5. 等 CLI 回報登入成功，再做下面的只讀驗證。

此模式不需要 SSH port forwarding：瀏覽器取得授權回應，遠端 CLI 接收貼入的 URL，核對 OAuth state 並以 PKCE 交換 token，憑證儲存在遠端 Codex 的 credential store。不要把 callback URL、authorization code、token、完整 credential store 或帶授權參數的網址貼到聊天、issue、PR 或日誌。

可將第 2 步存成遠端私人 launcher，目錄 0700、script 0700，位於 Git 之外。script 只放 CLI 路徑與 scope 名稱，不放 token。之後用 `ssh -t lab-host /private/operator/reauthorize-access.sh` 啟動；這個 script 路徑屬於遠端機器。本輪 launcher 由助手建立，並非從本機瀏覽器推知檔案。

## 登入後驗證

先確認 credential metadata 的 scope 名稱與到期時間；不要輸出 credential 值。再用已連線 MCP 做最小只讀操作：列出 D1、Workers custom domains、Access applications 與 service tokens，輸出成功狀態與數量即可。service-token 列表或其他 API 回應也不應整份公開。

| 用途 | 本輪 API scope |
| --- | --- |
| D1 查詢／建立 | `d1.read`／`d1.write` |
| Workers source／custom domains | `workers-scripts.read`／`workers-scripts.write`；metadata read 不足以取代 |
| Access app 與 policy | `access-app.read/write`、`access-policy.read/write`，各自是獨立 scope |
| Access service token | `access-service-token.read/write`，各自是獨立 scope |
| Access 使用者身分查詢 | `access-audit-log.read`；不是猜測的 `access-users.read` |

表中的 `/` 是 read 與 write 的縮寫，不是可直接傳給 CLI 的 scope；完整拼法以登入命令為準。只讀成功證明該路由可用，不能證明寫入或整個部署已完成。

## 故障分流

| 現象 | 檢查與處理 |
| --- | --- |
| SSH `channel ... connect failed: Connection refused` | 舊模式的遠端 callback listener 可能已退出或逾時。SSH tunnel 本身仍可存在，但目的 port 沒有 listener。重新啟動上述 `--no-browser` 流程，不重用舊 port／URL。 |
| `invalid_target`，resource 必須恰好一個 | 核對新授權 URL 的 resource 與 provider metadata；本輪唯一 configured resource 是 `https://mcp.cloudflare.com/mcp`。曾在 resource 已正確時出現此錯誤，根因未確認；新 session 後成功不等於已證明根因。不要刪 state、改 PKCE 或重用過期 URL。 |
| CLI 已成功、工具仍回舊 scope 的 401 | 區分已保存 credential 與現存 MCP client 快取。重新載入該 MCP 連線／重開使用它的 Codex session，再重做同一只讀查詢；不要立即重複授權。 |
| 403 提示沒有 OAuth scope 可涵蓋 | 例如本輪 account subscriptions 端點。新增無關 scopes 不會解決；保留「無法透過此連線查證」，依 owner 確認的 Free／零新增付費限制操作。 |
| 公開 metadata 在某 HTTP client 回 403 | 本輪 Python 預設 User-Agent 曾被 Cloudflare 擋下，curl 可讀。這是 HTTP 存取差異，不能推成帳號 scope 缺失。 |

Provider metadata：`https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp` 與 `https://mcp.cloudflare.com/.well-known/oauth-authorization-server`。核對目前回應，勿以過去值自動修改既有登入請求。

## 接手紀錄

公開紀錄只保存 CLI 版本、程序、scope 名稱、成功／失敗分類與尚未驗證事項。私人紀錄另存 SSH alias、launcher 絕對路徑、目標 account／zone／app／DB ID、授權窗口及操作 receipt；不得把它們放進 repository。

本輪已完成補授權與 Access 最小只讀查詢。Owner 確認 Workers Free，費用目標 0；沒有付費升級授權。這些前置條件解除不代表 [live gate](deployment.md) 已通過。
