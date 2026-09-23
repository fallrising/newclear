# 示範操作與重演指南

這是單企業、多團隊的前端模擬工作台。資源、發布、觀測與健康樣本都是示範資料，沒有雲端帳號、真正部署或外部監控。四個 persona 用於探索固定授權範圍，不代表正式登入或安全邊界。

## 啟動與開始

使用 Node24.18.0、pnpm11.18.0，從 `platform/dim-gate` 執行：

```sh
pnpm install --frozen-lockfile
pnpm build --mode demo
pnpm preview --port 4173 --strictPort
```

開啟 `http://127.0.0.1:4173/dim-gate/guide`。每個分頁有獨立 session，同分頁切換角色共享進度，重新整理沿用保存資料。第一次演示前，在「示範控制台」選「重置示範」並確認；reset 會清除這個 session 的變更、時鐘與排程。由其他分頁複製而來的 session 可能保留副本的起點，仍可自行重置。

1440×900 為主要展示尺寸；768px 可探索，390px 可讀摘要並局部橫向捲動表格。頁首提供明暗主題與密度。键盤使用 Tab／Shift+Tab、Enter／Space，原生選單用方向鍵；radio 群組以方向鍵切換。第一個「跳到主要內容」連結可略過導覽。Dialog 支援 Tab containment、Escape 與返回觸發鈕焦點。

## 三來源共用故事

以下主線使用 `checkout-api` 的新 staging 環境。每次重置後，分別改選 AWS、Aliyun、IDC（API 值為 onprem），其餘操作相同。Guide 的八項完成標記由已保存的 domain 資料決定，不能手動勾選。

| 步驟 | 身分與操作 | 應看到的結果 |
| --- | --- | --- |
| 準備 | Admin 在 Guide 檢查服務目錄、角色範圍，進「設定導航名稱」修改並儲存一個 label | 導覽即時更新，權限保持原本範圍；管理稽核留下記錄 |
| 來源 | Ops 在 Guide「檢查三種資源來源」，切換 Provider；再檢查共享依賴 | AWS／Aliyun／IDC 各20筆。拓撲可用 `ci-idc-redis-01` 加「反向影響」查看 consumers，表格與圖的關係相同 |
| 申請 | Commerce RD 從 Guide「提交環境申請」→「開始申請」，選 checkout-api、唯一環境名、staging、provider及對應 pool，填用途後提交 | 同一 request 進入待審核，尚未建立就緒環境 |
| 交付 | Ops 從 Guide「批准並交付」開啟該 request，核准並保留容量，再啟動交付；回 Guide 前進5ticks | request完成、job成功、environment ready；CI/placement出現，reserved轉used |
| 穩定版本 | Commerce RD 開「Pipeline 發布」→「觸發 Pipeline」，選新環境，輸入 `demo-stable-001`，前進6ticks | build/test/package/deploy/verify完成，候選發布成功才成為active |
| 問題版本 | 相同環境再發布 `demo-latency-002`，完成後回 Guide 選同環境，按「注入發布後延遲」 | 三個一分鐘模擬異常窗口；900ms、8%與incident相互對應 |
| 診斷 | Guide「觀測異常」→Trace→日誌；Ops從「調查事件」認領並填理由開始調查，查看影響拓撲與關聯發布 | 同app/env/release/trace可追查；配置影響只表示可能關聯，並非自動判定根因 |
| 回滾 | Commerce RD 從Guide「回滾並通過健康檢查」，選穩定歷史發布並填理由；前進3ticks | 新rollback release成功，active指向它；incident此時仍未解除 |
| 恢復 | Guide分別前進60ticks三次 | 連續健康樣本依序1/3、2/3、3/3；第三筆才resolved，異常歷史仍保留 |
| 稽核 | 確認Guide八步完成；Admin查看完整管理稽核，最後重置 | request/job、pipeline/release、incident及rollback可沿IDs/correlation追溯；重置後八步回待完成 |

主線 staging 不需 prod 發布審批。prod 由另一名具 scope 的 Ops 核准；發起者不能自批，Admin 沒有隱含部署權。回滾需要同環境、不同 artifact 的成功歷史，因此不能跳過第一個穩定版本。播放僅在明確啟動後前進，重新整理或離頁不會根據離線時間自動完成工作。

## 錯誤與恢復

- 零結果、未知健康和 stale freshness 各自呈現；清除filter或重新讀取，不將缺資料當成零或健康。
- 提交中保留輸入並禁用重複操作；版本衝突需重新讀取後再確認。角色切換會重新確認scope並清除舊cache。
- 儲存寫入失敗回 `DEMO_STORAGE_FULL`，該次command不提交；先釋放瀏覽器儲存空間，再由Guide重置。若整個儲存不可用，重新整理後可明確選「使用暫存記憶體繼續」。
- 存檔損壞／版本不相容時，啟動畫面保留原bytes並提供明確reset或memory recovery。暫存模式不改原存檔，刷新即遺失暫存進度。
- session上限是3MiB、1000個成功domain/persona commands。抵達上限顯示錯誤，重置可重新開始；不會偷偷移除audit或冪等記錄。時鐘也是command。
- runtime讀取與寫入仍受當下授權約束；切換角色不會批准工作或使Guide自動完成。

## 本機驗證與證據

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:docs
pnpm check:contracts
pnpm check:ci
pnpm check:architecture
pnpm build --mode demo
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:e2e
pnpm test:smoke
pnpm benchmark
pnpm test:isolation
```

主suite包含M0–M4 regression與M5完整鍵盤及儲存故障情境；`test:smoke`在Firefox和WebKit各跑shell與AWS完整Guide。`test:isolation`重新建立demo及live builds，用真正同源sibling文件驗證service worker邊界。`pnpm benchmark`會重建demo、執行5次cold LCP與初始JSgzip、100次5000CI engine query和100次HTTP command；完整樣本在`test-results/performance-results.json`及M5報告，不以最快一次數值表示驗收。

瀏覽器輸出保存在 `playwright-report*`／`test-results*`，含DOM、PNG、原始HTTP/console及focus/axe附件；CI artifact保存30天。固定commit與驗收結果以 [STATUS](STATUS.md)、[PLAN](../../../.team/PLAN.md) 和task/attempt reports為準，命令存在本身不表示已通過。

## Hosting需求與限制

只需靜態host，HTTPS或localhost，配置`/dim-gate/*` browser-history fallback到此app的index.html，資產保留正確MIME。worker的URL和scope均為`/dim-gate/`。本輪僅驗證本地production serving，沒有部署網站。

`VITE_DATA_MODE=live`顯示「尚未提供」，不會fallback到demo、註冊MSW或初始化demo存檔。真實SSO、雲資源、CI runner、APM collector、多使用者協同及正式backend授權皆需另立整合範圍。5,000CI只作唯讀效能profile，不能把它當作3MiB持久化session的支援容量。


## W1 工作區體驗

頁首「工作區」顯示 RD 業務研發、Ops 維運或 Admin 平台管理；它只列當前身分的合法入口，不更换 user。旁邊「Demo · 體驗其他角色」會更換示範身分並前往該角色首頁，同一分頁仍共用既有服務／資源／申請與發布紀錄。多角色體驗：Admin → 角色與範圍 → 為 Commerce RD 新增 Ops pool/project grant → 切回 Commerce RD → 在工作區 selector 切 RD/Ops；各 sidebar 分開、身份不變。無 grant 使用者仍可由 Demo 入口恢復探索。

RD 首頁從服務健康與申請／發布下鑽；Ops 首頁從事件、失敗、待審與容量下鑽；Admin 首頁查看待發布目錄、整合與權限變更。首頁範圍可選專案／環境，Ops 加來源／資源池；返回與刷新保留 URL。沒有樣本為 unknown，時效與業務成功狀態分開。Redis／Kafka 新申請、配置灰度、告警規則及平台feature/route/channel仍依 W2–W5另行交付；目前不提供空白或假成功入口。
