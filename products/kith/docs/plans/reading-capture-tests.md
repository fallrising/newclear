# 閱讀快記 RC 測試清單

對應 [MVP 計畫](cloudflare-reading-capture.md) §6–7。本清單於階段 0 設計；階段 1 RC-01～04 已有本地 CF 桌面／手機 E2E，實際命令與限制見 [#456 報告](../../tasks/456-reading-capture-phase1/report.md)。階段 2 的本地 RC-01～07 十二項已通過，見 [#463 報告](../../tasks/463-reading-capture-phase2/report.md)；最終回歸、CI 與獨立審查以 PR #464 證據為準。

## 共用測試條件

- 隔離本地 Cloudflare/D1、合成 operator、一般 member、未登入瀏覽器，固定 clock/ID；不讀寫正式資料或呼叫付費 provider。
- 手機 viewport 與桌面 viewport 各跑必要使用流程。保存前後比對 D1、UI 與 HTTP，不能只看 toast、status code 或截圖。
- 合成 Git bare remote 與工作目錄、文章 A/B 的固定建置 commit、可注入 Runner/push/build 失敗；無外部 repo 或部署。文章穩定 ID 在改名與版本切換間不變。
- provider spy 在快記／補充路徑的呼叫數必須為 0；聊天室 messages 的 row count 與原資料不變。所有資料修改使用參數化 SQL、有限 body 和分頁；失敗回應不得洩漏私人正文。
- 記錄來源 SHA、fixture 版本、實際命令、exit code、HTTP/SQL 斷言及必要截圖；遮蔽 token/cookie。禁止以 sleep、重新執行到通過或跳過失敗案例替代斷言。

## 階段 1：快記與收件匣

| ID | Given / When（含故障注入） | Then／必要證據 |
| --- | --- | --- |
| RC-01 | 手機 operator 輸入含換行、Unicode 與前後空格的原文並送出，重新載入頁面 | HTTP 回 capture_id；D1 恰一筆、body 原樣；收件匣重載可見且標「已保存」；尚未匯出顯示待匯出；provider 呼叫 0、messages 無變化 |
| RC-02 | 在 D1 commit 後、成功回應送達前切斷回應；同 client_key 重送，另加兩請求同時送入與不同 key 的對照 | 同 key 只有一筆且回同 capture_id；不同 key 各自保存。相同 key 改 payload 不覆寫原文，明示衝突且不能誤顯示新 payload 已保存；timeout 顯示結果未知，保留同 key 重試 |
| RC-03 | 離線輸入後 reload；送出前斷線；本機 storage 寫入失敗；重新連線 | 可保存到本機者顯「本機草稿」並保留原文，沒有伺服器保存證據時不能顯「已保存」。storage 失敗需告知未存妥；不假裝已有離線隊列，不自動另配 key 重複送出 |
| RC-04 | 未登入對快記讀寫、notes 讀寫、匯出讀取與 ACK 的預定路由送請求；另測一般 member、過期 session、缺少或錯誤 CSRF | 未登入／過期為 401；已登入非 operator 為 403；需 CSRF 的 session 寫入拒絕錯誤 CSRF，資料完全不變、正文不洩漏。階段 1 先建立涵蓋 notes/export 預定路由的認證防線，不能拿無路由 404 當作認證通過。operator 對尚未實作的功能不得收到假成功 |

階段 1 需先寫本地 CF E2E 並觀察 RED，再實作上述功能。RC-04 涵蓋所有預定端點的拒絕路徑；階段 2 接線後必須重跑，並新增正向操作與 Runner 撤權驗證。

## 階段 2：閱讀、補充、建置與匯出

| ID | Given / When（含故障注入） | Then／必要證據 |
| --- | --- | --- |
| RC-05 | Runner 停止時連續保存 captures/notes；恢復後匯出；分別在寫檔後、commit 後、push 後但 ACK 前中斷 | 保存始終先在 D1 成功且不等 Runner；恢復後全部可在遠端 Git 讀到；固定路徑不重複、相同內容不新增 commit；只有遠端持久化的快照才標已匯出；push 失敗或衝突保持待匯出 |
| RC-05 競態 | Runner 讀 note revision 1 後人類改為 revision 2，再回報舊 ACK；兩次編輯在同 clock tick；人工改 Git note 後匯出 | 舊 ACK 更新 0 列，revision 2 仍待匯出；下一輪覆寫同一路徑，遠端原文等於最新 D1；人工更動記錄覆寫事件。單一 Runner 序列化，不讓舊快照後寫；ACK 重送不破壞狀態 |
| RC-06 | A 文章已有人類補充；內容 repo 更新 AI 正文並改檔名，從固定新 commit 建置；B 為對照 | 閱讀頁自動取得新建置 commit 與正文（明確測試更新機制，不以手動 reload 代替）；A 的穩定 ID 仍對回原 notes，body/revision 未變；AI 在上、人類在下且有分隔線；B 不變。未知或重複 article_id 應使建置失敗，不能猜測對應 |
| RC-07 | 從成功版本更新時注入內容解析錯誤、產物缺失或 build failure，並持續保存快記 | 上一版完整目錄／正文／commit 仍可讀，不能混合新舊產物或上傳半成品；快記繼續成功、重新整理可見；下一次成功建置才原子切換。建置發布測試僅用本地替身，不執行正式部署 |

附帶檢查：人類補充編輯同交易更新 body/revision/updated_at 並清除 exported_commit；重複文章補充不新增第二份；安全 Markdown 拒絕 script/不安全 URL；Runner 憑證僅具匯出／ACK 權限、不可讀聊天室或任意改 notes，撤權即拒絕。具體認證方案在階段 2 前依既有契約選定，不在此文件填入秘密。

## 階段 0 已提供的隔離檢查

[test_schema_draft.py](../../test/reading_capture/test_schema_draft.py)用 Python 標準函式庫 SQLite 建立原階段 0 聊天室 migrations 0001～0006，再套用 docs 內的草稿；新增檢查確認正式 0007 保留完整草稿 DDL。正式 migration 另由隔離 D1/E2E 載入，檢查兩表隔離、原文保留、client_key 唯一、必要欄位／bytes 上限、notes 唯一／revision、交易 rollback、舊 ACK 與待匯出索引。

從 repository root 執行：

```sh
python3 -m unittest discover -s products/kith/test/reading_capture -v
```

這不證明 D1 執行環境、HTTP 冪等回應、CSRF、瀏覽器草稿、Git 匯出或 RC-01～07 已通過。實際 RED/GREEN 與工具版本見 [交付報告](../../tasks/446-reading-capture-phase0/report.md)。

## 階段 1 接線契約（#456，實作前凍結）

- `POST /api/captures` 僅接受 `{body, client_key}`；原文 UTF-8 1～16384 bytes（全空白合法，不 trim；拒絕 NUL 與未配對 surrogate）。key 為 1～128 個 ASCII 字母、數字、`_`、`-`。成功 201（新建）或 200（同 key 同原文），JSON `{capture_id}`；同 key 異原文 409 `capture_conflict`。錯誤不含正文。
- `GET /api/captures?limit=20&cursor=...` 回 `{captures:[{id,body,source,created_at,exported_commit}],next_cursor}`；limit 為 1～100 整數，cursor 是有長度限制的 opaque keyset（created_at/id 降序），無更多資料為 null。錯誤 query 400。
- 全部 captures 路由、`GET/PUT /api/notes/:article_id`、`GET /api/reading-export`、`POST /api/reading-export/ack` 都先檢查 operator session；後兩種功能階段 1 對 operator 回 501，其他 caller 401/403，不用 404 充數。私人回應 Cache-Control: no-store。沿用 session 寫入 CSRF。
- Web `/captures` 僅 operator 可見，入口 `capture-link`；`capture-body`、`capture-save`、`capture-status`、`capture-inbox`、`capture-more` 為測試定位點。收件匣每筆 `data-capture-id`，正文保持空白與換行，明示已保存／待匯出或已匯出 Git。
- 草稿以登入 operator ID 分隔，包含 body、client_key 及不確定結果的送出快照；送出開始後文字鎖定，未知結果以原 key/原文重試。明確成功才清空；衝突保留並告知未保存，不自動換 key；僅使用者明確點選「以目前文字建立新快記」後，以新 key 保留為未送出的草稿。儲存失敗明示，不能標本機已存妥。沒有自動送出或離線隊列。
- 離線時已開啟的頁面可輸入、保存本機草稿；離線 reload 若靜態 app 無法載入，瀏覽器顯示離線頁，重連 reload 後恢復草稿。這個 MVP 不新增 service worker 或宣稱完整離線 app；另以 API-only 斷線驗證 shell reload 時草稿復原。
- E2E 使用既有 evidence harness，擴充 acceptance ID 為 E2E-RC-01～04；保留 W0～W7 驗證。以隔離 D1 查詢和 provider spy 計數核對不變量，僅合成資料。

## 階段 2 接線契約

[reading-capture-phase2.md](reading-capture-phase2.md) 固定 registry／bundle、筆記 CAS 與遺失回應、專用匯出憑證、全量分頁對帳、ACK、journal 與遠端確認。它取代上述階段 1 歷史契約的 operator 501；匿名／member／CSRF 防線保留，並新增專用 bearer 僅限 export/ACK。實作未接入正式發布。
