# M1 首輪真實閉環 — 2026-10-27

後續 owner 明確批准備份傳輸後，[首次隔離還原](m1-isolated-restore.md)已通過；以下保留首輪當時的結果與阻擋，不回寫成當時已完成。

基準 `95fdf5f8ef4e548e6854f8838385913dff4877b2`。Owner 授權沿已選私人目標繼續部署，確認 Workers Free、費用目標 0，不授權付費升級。本紀錄是 T-0003-4 的實際進展，**不是完整 M1-LIVE／AC-06～08 驗收**；Git 交付與瀏覽器結果另列，不由部署成功推導。

## 已觀測結果

| 邊界 | 實際證據與限制 |
| --- | --- |
| OAuth | 補齊 D1／Worker／Access scopes，最小只讀查詢成功；[無桌面操作](../headless-oauth.md)記錄 callback 回貼、逾時、舊 client 快取與未確定根因 |
| 本機 CF runtime | Wrangler 4.153.0 的 Miniflare 5.20261023.0-beta，實際 workerd、D1 binding、產品 modules 與資產；通過 migration、batch rollback、並發 CAS、匿名拒絕、合成 human JWT 資產、HMAC submit→claim→report／artifact ACL |
| 真實 D1 | 只建立獨立新庫；兩個並發 CAS 的 changes 為 0／1。故意讓 batch 第二次 INSERT 違反 UNIQUE，確認第一筆也回滾；之後套用產品 schema 與四個 scope grants |
| Access | 新 app 的確切 owner email allowlist 與指定新 service token 的 `non_identity` policy 均回讀一致；沒有 bypass／任意 token policy。先有 policy 才 attach hostname |
| Worker | 精確 modules／資產及 secret bindings 已上傳；版本回讀 `raw_run_worker_first=true`、`serve_directly=false`，DB／ASSETS／兩項 secret bindings 均存在；workers.dev、preview 關閉 |
| 入口／機器呼叫 | 五條匿名路徑被拒絕或導向 Access；獨立 bot 的 authenticated bootstrap／scope／command list 通過。這不等於 human／mobile 或所有撤權情境通過 |
| 真實執行 | 明確提交一個固定唯讀 command，non-root runner 只跑 `--once`，使用真實 OS collector 與持久 journal。probe resume 使用原 bytes/key/deadline；結果 `validated`、validator `passed`、health `healthy` |
| 收尾狀態 | D1 只有一筆 command，`result_recorded`、active=0；schedule enabled=0、firings=0，Cloudflare Cron 列表空。沒有常駐 runner、主機入站 listener、Grok 或 agent adapter |
| 費用 | Owner 確認 Free；未新增付費訂閱或啟用付費產品。OAuth 無法查 account subscriptions，不能聲稱帳單已驗證為零；不是量測過的長期容量承諾 |

本輪 Access service token 為 24 小時；Lab grants 比它提早一分鐘到期。到期會拒絕新操作，不自動延長或排程更新。實際到期時間、目標 ID、身分與 receipts 留在私人紀錄。Access user ID 對應 JWT `sub` 的依據是 [Cloudflare application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)；真正瀏覽器登入仍需單獨確認。

## 保留的失敗與修正

1. `M1-workerd-qualification-1`～`5`：固定版本的 Miniflare constructor／模組及 assets router 設定與舊介面不同；先後遇到 options validation、缺 module 與缺 user-worker binding。依已安裝來源改用 V4 converter、明列三個 module 與 `has_user_worker=true`，第 6 輪通過原有檢查。這些是測試啟動失敗，不能當產品成功。
2. T-817 初審發現成功登入後的資產路徑未覆蓋。第 7 輪新增合成 RSA JWT／local JWKS 後，真實 workerd 回 503。一次明示的診斷 module 顯示 Workers 不接受 `redirect:'error'`；該診斷不作 qualification 證據。產品改 `manual`，立即以 `response.ok` 拒絕轉址；移除診斷覆寫後，第 8 輪以原產品檔案通過三個資產 exact bytes／安全 headers，且 redirected JWKS 得 401、沒有跟隨。T-817 focused follow-up ACCEPT。
3. 真實 `probe-readonly-1` 的 bootstrap 回403。受控對照只改 User-Agent：Python 預設得到 Cloudflare 1010、明確產品識別得到200。既有 loopback tests 兩項先 RED，再於兩個 Python client 設定 `cloud-lab-m1/1.0`；完整89 tests GREEN，`probe-readonly-2` 通過。沒有改 Access／WAF 規則、代理、TLS 或轉址保護。
4. 第一次提交的 probe 退出1、execution=`accepted`，表示尚未執行，並非成功。runner 退出0後 resume 才退出0、execution=`validated`；沒有產生替代命令。
5. D1 export 開始後，較晚的 poll 回 `Not currently exporting anything.`，沒有取得備份檔。後續即時 bounded polling／下載提案被自動審批拒絕：要求明確批准敏感資料傳輸及目的地。未重試或繞過；D1 匯出／隔離還原保持 pending。runner journal 已用 SQLite online backup 備份，來源及備份 integrity_check 均為 ok；這不等於 D1 還原成功。

## 可重現的本機檢查

本機 dev tool 僅安裝在 shared workspace 的 task build 目錄；產品無第三方 runtime dependency，repo 未新增套件管理器／lockfile。固定工具版本，不依未來 latest 重現。下面使用示意路徑，實際 launcher task 證據見後表。

```sh
python3 /path/to/agent-workspace/workspace.py run cloud-lab unique-runtime-check -- \
  node platform/cloud-lab/tools/qualify_runtime.mjs /path/to/pinned-toolchain
python3 /path/to/agent-workspace/workspace.py run cloud-lab unique-regression-check -- \
  python3 platform/cloud-lab/tools/check.py
```

`qualify_runtime.mjs` 需要該 toolchain 下可解析的 Miniflare。它固定 loopback、關閉 telemetry、state/tmp 放 `AGENT_BUILD_DIR`；合成 JWT、公鑰與資料只在本機。成功紀錄寫入 `AGENT_EVIDENCE_DIR/runtime.json`，每次使用新的 task ID。

| launcher task | 已執行結果 |
| --- | --- |
| M1-cf-toolchain-pin／M1-cf-runtime | npm 查得並隔離安裝 Wrangler 4.153.0；未做 global install |
| M1-workerd-qualification-8 | 真實 local runtime 六組邊界檢查 passed；不是雲端驗收替身 |
| M1-user-agent-red | 兩項 loopback HTTP tests 如預期 FAIL，保存原先預設 UA 行為 |
| M1-user-agent-green | `check.py`：31 Node＋58 Python＝89 tests passed，兩份日誌保留 |
| T817-review／T817-review-followup | gpt-6-astra/high，read-only，host timeout300秒，MCP/apps/delegation停用；初審 REWORK、focused ACCEPT；正常退出、無命令失敗或拒絕 |

T-817 是限定 code／提供證據的獨立檢視，未自行跑 cloud 或讀私人資料；不冒稱 reviewer 已複現 live。主導檢查實際 private receipts 與命令結果。

部署 bundle 的 Worker／資產 hashes 與上傳前 source 相等。後續 UA 修正只影響 Python client；第一次實際 runner 使用另存的當前精確 source，沿用同一 private runner config，舊 bundle 與 manifest 未覆寫。source SHA-256：

- Worker auth：`c9186d49555ee1acde5a78b7b491e787828dd40d6301a43fc4cf5c9172fe92d3`
- 實際 runner：`9259deaad4516a68f130bbb07c66a02eeed9db02a17f33d308710a393365d0fa`
- probe：`92a6f8e2d45346a73268c8edce116c6a2169361e3969cf3bd947452499e41404`

## 尚待驗收

Human／mobile 操作、真實撤權／輪替、完整失聯／重啟／晚到／unknown 故障矩陣、所有替代入口的 HTTP 實測、配額／觀測窗口及 D1 隔離還原仍未通過。Grok bot、Queues／Workflows、agent 平台及長期無人值守另有後續範圍。AC-06～08 保持 pending，無 usable tag。

後續操作順序見 [部署操作紀錄](../live-operations.md)；不能直接盲重播 provisioning receipts。

## 最終整合審查與文件驗證

[T-817](../../../../.team/reports/T-817.md)與[T-818](../../../../.team/reports/T-818.md)均對各自限定範圍給出ACCEPT；後者單次180秒host上限，檢查UA修正、published source hashes及public claims，未自行存取cloud／private receipts。主導已跑44專案契約、7 llms、28文件／219連結／12固定來源與diff檢查。初次llms檢查因新文件未入Git index報3個broken links；將已審閱文件正常stage後通過，未改弱validator。T-817報告第一次格式檢查因狀態標記後有句點失敗，修正格式後通過。
