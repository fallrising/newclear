# Mock vertical slice

第一個可執行切片刻意保持簡單：Node.js backend + memory store、mock Agent、React/Vite dashboard。它先確認資料流與 UI，不接真實主機。

## 跑法

需要 Node.js 20+。三個 terminal：

1. `make run-backend`
2. `make run-agent`
3. `cd web && npm install && npm run dev`

backend 與 mock-agent 無第三方 runtime dependency；web 首次需要 npm install。Agent 每 5 秒上報。停止 Agent 約 90 秒後 API 會標為 offline；重啟後恢復 online。

## 這批刻意未做

Cloudflare D1/DO/R2 wiring、enrollment/signature、WebSocket、logs/jobs/bootstrap、真實主機採集與完整 E2E。M0 已有的 contracts/fixtures 保留為後續接線依據；本切片不重造它們。
