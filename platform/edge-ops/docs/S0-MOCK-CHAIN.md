# S0 — 前後端與 Mock Agent 資料鏈路

日期：2026-09-28。Owner 在 PR #161 合併後，明確要求先開發前後端骨架，使用 mock 驗證資料流。此增量定義有界 S0；不修改 M0/M1 的生產認證、Go Agent 或安全驗收標準。

## 目標與假／真邊界

假的是主機、CPU/記憶體等輸入值和身分驗證；真的包括獨立程序發出 HTTP、Worker 共用邏輯、schema 驗證、SQL 交易、持久化、查詢、React API 消費與失敗狀態。

S0 沒有實作 production mode。Node listener 只 bind 127.0.0.1；Worker 同時要求 `MODE=demo` 與 loopback URL。模擬的 `X-Edge-Demo-Role` / `Authorization: Demo node_demo01` 是明文角色標記，任何能存取此開發入口的人都可冒充；不是安全登入。不能用反向代理把它公開。沒有真實 API secret、node key 或雲帳號。

## 可觀察主線

空資料庫 → CLI enroll → 每台 12 筆合成樣本 → 3 台 / 36 筆 → API 清單及 CPU 詳情 → 重送仍 36 筆 → 時鐘 +240 秒 → 全部離線 → 第一台新上報 → 37 筆 / 第一台恢復 → 後端重啟仍 37 筆。

`seed` 只允許空庫，避免覆蓋；`reset` 明確清除本 demo 的合成資料。`offline` 只改 demo DB 的 clock offset，不改 OS 時鐘。CLI 是單次產生器，不會持續自動上報，因此閒置後出現 stale/offline 是預期行為。

## Runtime 與可替換邊界

`backend/src/worker.ts` 使用 Request/Response、Web Crypto 與 Database interface，不 import Node API。`Store` 接受 D1-shaped binding；Wrangler 配 local D1。`scripts/sqlite-d1.mjs` 是 Node SQLite 測試 adapter，transaction 真正落入 SQLite，但不是完整 Miniflare／D1 emulator。

Node host 同時服務 built React 及 API；Vite dev 可透過 proxy 呼叫同一 API。先採每 2 秒 bounded HTTP refresh，UI 明示 WS 未接線；不冒稱 Durable Object 已完成。後端中斷時保留舊快照但標為未確認，沒有 fallback 到前端生成資料。

## S0 contract

來源是 `contracts/types.ts`、`validation.ts`、`telemetry.schema.json`、fixture 與 `openapi.json`。OpenAPI 登記 8 個 S0 operations、request schema、假身分與錯誤狀態；完整 response schema/code generation、Go 相容與 production crypto vectors 仍屬 M0 未完成項。

- `edgeops.telemetry.demo.v1` 與未來 production schema 分開；未知欄位／major 拒絕，duplicate decoded JSON keys 拒絕。
- 只允許 10 個 synthetic IDs、generation=1；body 上限 16 KiB，比完整 SDD 更嚴格。
- CPU 平均／峰值為一分鐘窗口；null 是不支援，不填 0。uint64 counters 以十進位字串傳送，避免 JS 精度損失。
- `sent_at` 是新傳輸 envelope；`observed_at` 是採集時間；`received_at` 是持久化接收時間，不能混用。
- 去重 key `(node,generation,boot,seq)`；logical sample hash 不含 `sent_at`。相同 payload 回原 receipt，內容衝突回 409，不更新心跳。
- SQL INSERT 與 heartbeat projection 同一 batch；projection 只在該 request 實際贏得 INSERT 時更新。故障不回假 ACK。
- 查詢最多 240 點、7 天；每 node 最多 4096 retained samples，超額回 429，需明確 reset 或等待 retention。沒有無界記憶體隊列。
- 心跳 90 秒後 stale、210 秒後 offline；health 另依最新 observed sample 判斷。舊 backfill 不蓋新樣本，API失聯不等於所有主機已離線。

## 驗證層次

1. `npm run check`：無 npm dependencies 的契約形狀檢查、19 個 backend tests + 2 個 HTTP/driver tests。HTTP case 呼叫獨立 CLI 程序並重啟檔案型 SQLite server。
2. `backend` typecheck / workerd smoke：安裝鎖定工具鏈，啟動真正 local workerd + local D1，再跑 seed/replay/offline/recover/history。與上一層分開驗收。
3. `web` build / Playwright：真正 React build、真 HTTP server，5 個 browser journeys；含 mobile、deep-link refresh、API 503、escape 測試及截圖。

CI 只做上述隔離測試，沒有 deploy/publish/production credentials。本地通過不等於 CI 已通過；各層結果、版本及未完成項記於 STATUS。

## 工具鏈來源與限制

開發容器無法 DNS resolve GitHub/npm，因此沒有假造 `npm install` 或手写 transitive lock entries。前端從 `platform/agent-platform/web/package-lock.json`、後端從 `products/kith/package-lock.json` 複用固定 base `05809fc951ef929665e798846aba348d6c9071a5` 的既有完整 dependency snapshot。兩份新 manifest 的 dependency/devDependency 版本與快照相同，root package 名稱改為 edge-ops；鎖檔保留原始 root name metadata。沒有依賴相鄰元件的原始碼或執行環境。

此作法暫時包含未用到的工具；後續在可連 npm 的環境中重新產生最小 lockfile、整理名稱 metadata，並保持 clean `npm ci` + tests。未做安全掃描的套件不宣稱零漏洞。新套件版本是否可安裝由實際 CI 核對，不以 repository 宣告代替驗證。

## 後續順序

先 owner 在本地接受 S0 的功能與 UI → 補全 M0 response schemas、TS/Go vectors、真實 enrollment／crypto／CAS gate → M1 real read-only collector → 再評估 DO/alerts。logs、R2、host jobs、execd、bootstrap 全部仍不啟用。S0 的 fake credential 不得沿用到下一階段。
