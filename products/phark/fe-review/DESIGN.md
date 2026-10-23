# FE Review — phark — DESIGN

> 活文件：第 2 輪的修改與驗收範圍。狀態：**草稿，待確認**。本次只讀來源與修改文件；沒有啟動 UI、建立帳號或執行截圖。

## 目標

讓既有三欄時間線、帳號、回覆、通知、個人頁、搜尋、媒體與檢舉流程，能在隔離環境以合成資料重現並接受前端品質檢查。保留手機橫向 deck、桌面三欄及既有 API／Session／CSRF 語意；不以本設計宣告產品主線或 production durability 完成。

## 依據

- 已決定：issue [#155](https://github.com/fallrising/newclear/issues/155) 允許 dormant 元件在第 2 輪於設計範圍內修改前端；不恢復功能投入，不做 major 升級。
- **D1 假設，待擁有者確認**：採 [REVIEW.md](REVIEW.md) 建議，由 `fe-review/` 的獨立腳本透過既有 API 建立合成資料，不新增後端 seed 指令、不直接修改 SQLite。下列 M1 以此為前提。
- 規範：[PROTOCOL](../../../docs/fe-review/PROTOCOL.md) §0、§1、§3、§4、[SDD](../../../docs/fe-review/SDD.md) AC-10／AC-15、[元件規則](../AGENTS.md)、[SUCCESS](../SUCCESS.md)。AC-15 的 owner 確認尚未發生，不能以文件檢查代替。
- API 邊界：[帳號規格](../docs/specs/005-accounts-profiles/spec.md)、[媒體規格](../docs/specs/010-media-attachments/spec.md)、[濫用控制規格](../docs/specs/011-moderation-abuse-controls/spec.md)。保留認證、CSRF、速率限制、author identity、opaque cursor 與既有錯誤契約。

## 不做的事

- 不新增產品功能、主題切換器、單欄切換模式、後端 API、migration、seed endpoint、依賴或 CI；不修改部署與 SDD-012 durability 主線。
- 不移除認證／CSRF／速率限制，不使用正式資料、既有帳號、憑證或對外綁定。
- 不把 API mock 的畫面當真實接線證據；不以靜態檢查或既有歷史驗證宣告 usable qualification。
- 本輪不補 dark mode：[`index.css`](../frontend/src/index.css):30 只有 `:root` 色票；:3 的 dark variant 宣告不等於已實作深色主題。先驗收現有 light mode。

## 修改項目

### M1 合成資料與可重現的擷取前置作業

- 對應：C1、D1。
- 現況：[`vite.config.ts`](../frontend/vite.config.ts):13 將 `/api` 代理到 Spring；[`App.tsx`](../frontend/src/App.tsx):250 初始化 CSRF 與 session。沒有獨立的 FE review seed／互動 harness。路由實際存在於 `App.tsx`:129，並非只有無路由的 view 切換。`frontend/package.json`:6 只有 dev／build／lint／preview，沒有 test script。
- 修改：第 2 輪新增限定 `fe-review/` 的 API fixture／互動腳本及說明，使用隔離、全新的 DB 與 media 目錄。腳本只接受 loopback base URL，拒絕其他位址；先建立匿名 cookie jar、讀 CSRF，再註冊兩個執行時產生的帳號，分別登入並在認證轉換後重取 CSRF。以實際回應保存動態 post／reply ID、handle、cursor，不假設固定數字 ID。建立三個 channel 的貼文、單層回覆、like／repost／通知及一張即時產生的無個資 PNG；執行既有 API，不直接改 DB。每次使用新的狀態目錄；資料量受速率限制約束，遇 429 依契約等待或中止並記錄，不停用限制。
- 驗證：新增 harness 自身的 loopback 拒絕、重複執行／新狀態、CSRF 更新、回應 ID 綁定及清理檢查。先做 API contract mock 的 loading／empty／401／403／429／500 畫面，再做真 Spring＋SQLite 整合流程。Mock 僅在測試瀏覽器攔截且不得 fallback 到外網。回應 shape 依 `src/api/` 與 `src/types/`，不得修改產品 API 以迎合 fixture。
- 風險與回滾：fixture 若建立過量資料會觸發 quota；失敗保留非秘密摘要，清理只刪本次已記錄的可丟棄目錄，不掃描其他 DB。回退本項腳本與對應 targets 即可；不需要資料庫回滾。這些腳本**尚未存在**，本設計不提供可直接執行的 seed 命令。

### M2 保持 deck 行為的響應式修整

- 對應：C2。
- 現況：[`App.tsx`](../frontend/src/App.tsx):837 使用固定視窗高度計算與手機橫向 overflow；[`Column.tsx`](../frontend/src/components/Column.tsx):50 設 280px 最小欄寬、:57 內層垂直捲動；[`PostCard.tsx`](../frontend/src/components/PostCard.tsx):103 呈現保留換行的內容。長連續字串與較高 header／composer 是待實測風險，尚無截圖證明破版。
- 修改：只在 `App.tsx`、`Column.tsx`、`PostCard.tsx`、`ReplyThread.tsx` 與必要現有樣式內補 `min-width`／文字換行／可用高度等局部規則。維持三欄、手機橫向 deck 與既有捲動意義，不改資訊架構或加入切換模式。實測沒有問題的區域不改。
- 驗證：390×844、834×1112、1440×900，以長中文、500 字貼文、長連續字串、長 display name、圖片與回覆測試。頁面本身不得水平溢出；刻意允許的 deck 容器橫向捲動須在報告附 selector、scroll/client width、可操作性證據，不能掩蓋其他 overflow。確認縮放、鍵盤焦點與每欄 load-more 仍可到達。
- 風險與回滾：overflow 修改可能切掉 focus ring 或改變捲動容器；逐項截圖比對與鍵盤重跑，回退單項樣式修改，不改分頁／資料流。

### M3 既有表單與狀態的可讀性、鍵盤及錯誤呈現

- 對應：C2。
- 現況：[`Composer.tsx`](../frontend/src/components/Composer.tsx):215 將文字錯誤放在一般 span，:253 圖片錯誤已有 alert；[`App.tsx`](../frontend/src/App.tsx):832 的初始 loading／error 為一般文字；[`ReportControl.tsx`](../frontend/src/components/ReportControl.tsx):86 已有送出狀態、:126 status／alert。這是檢查清單，不是已驗證的 a11y 缺陷結論。
- 修改：只在既有 frontend components 補必要 label／description 關聯、status／alert、pending 名稱及 focus-visible，避免多重 live region 重複播報；保留原本檢舉表單、固定 reason、提交意義與登入登出行為，不加新的確認流程或改變產品文案語意。
- 驗證：鍵盤完成登入、composer、回覆、like／repost、通知已讀、個人頁、搜尋與檢舉；以 mock 重現請求中／失敗／匿名／安全初始化失敗。確認錯誤與 request ID 可理解、pending 不重送、既有 optimistic rollback／去重與 session 切換重讀仍成立。跑既有 lint、build，並以測試瀏覽器與 axe 檢查 critical／serious、focus、名稱及對比；專案目前沒有可直接執行的 frontend test script。
- 風險與回滾：ARIA 可能過度播報，focus 修整可能移動使用者位置；以實際鍵盤與輔助技術檢查，逐項回退 markup／樣式，保留原本認證及 mutation 邏輯。

## 啟動方式（第 2 輪要驗證的版本）

以下均為**提案／未執行**，不是已就緒 harness。依 PROTOCOL §0，在獨立 network namespace 的容器內讓 Spring、Vite 與瀏覽器同處，服務只綁 `127.0.0.1`，不用 host networking、對外 published UI 或現有 volume。

1. 第 2 輪先建立本次 `fe-review/runs/.state/<run-id>/`，準備 DB／media 子路徑與即時產生的測試 HMAC secret，僅透過子程序環境傳入 `APP_DB_PATH`、`APP_MEDIA_PATH`、`APP_ABUSE_IP_HMAC_SECRET`。不用 prod profile；本機 HTTP 才用 `SESSION_COOKIE_SECURE=false`。來源設定見 [`application.properties`](../backend/src/main/resources/application.properties):11。Cookie／token／secret 不進 log、文件或截圖。
2. 在元件目錄提案啟動：`mvn -f backend/pom.xml spring-boot:run -Dspring-boot.run.arguments="--server.address=127.0.0.1 --server.port=8080"`。先確認合成狀態路徑與 loopback listener，再檢查 `/actuator/health` 及真正 API；health 不是完整驗收。
3. 在 `frontend/` 提案執行 `npm ci`、`npm run lint`、`npm run build`，再 `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`。build 已包含 `tsc -b`，不虛構獨立 typecheck／test script。所有建置與暫存依 repository shared launcher／隔離環境規則處理。
4. 執行尚待 M1 實作的 fixture，檢查目前 routes 後，將實際產生的 profile handle 加到 targets；登入狀態檔只放 git-ignored `runs/<run-id>/`。`targets.json` 的 ready `/` 只代表 Vite 頁面可讀，不能代替 Spring ready／seed 完成。必須實際整合跑通後才可把 `verified` 改為 true。

若 localhost proxy／安全 cookie／容器連線不符，記錄具體錯誤並提出限定 loopback 的部署注入修正；不以關閉認證或外部綁定解決。後端變更另提議，不屬本設計的直接實作範圍。

## 第 3 輪驗收

- 頁面：`/`、`/notifications`、`/search?q=fe-review`，及 seed 回應取得的 `/profiles/<handle>`；對每個 route 測 direct load、導覽與 back／forward。通知匿名狀態與登入資料分開驗收，不能把預期 401 當作正常登入畫面。
- 流程：註冊（不自動登入）→登入→三欄→純文字／圖片發文→回覆→like／repost→通知已讀→個人頁→搜尋／load-more→檢舉→登出；另驗證空、載入、錯誤、安全初始化與匿名狀態。分頁保留 opaque cursor 與 stable identity，不用畫面筆數代替冪等／去重契約。
- 條件：PROTOCOL 清單逐項 pass／issue／n/a；無 blocker／major、無非預期 console／request error、無 axe critical／serious、對比與鍵盤符合共用要求。三種 viewport、現有 light mode；dark 標 n/a（未實作），不得據此宣告 dark pass。
- 保留 capture JSON、來源 SHA、非秘密環境摘要與 REPORT；PNG、cookie、storageState、DB、上傳檔不提交。受控的 mock 錯誤需註記，整合 happy path 需真實後端證據。
- 不涵蓋正式環境、真實社交資料、部署、SDD-012 線上備份與營運告警；[SUCCESS](../SUCCESS.md) 的 pending AC 不因本文件改變。

## 開放問題

- **D1 仍待確認**：是否採用 M1 的 API fixture 來源？PR 假設清單必須明列，不把本次 owner 的工作授權寫成 AC-15 已完成。
- 實作後的可執行 fixture 命令、實際啟動時間／ready、動態 profile 路徑與擷取證據，均由第 2／3 輪補上。這些是待驗證項，不是已存在的 harness。
