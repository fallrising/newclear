# Loopback mock demo

S0 mock 鏈路的跑法。設計與邊界見 [S0-MOCK-CHAIN.md](S0-MOCK-CHAIN.md)，進度見 [STATUS.md](STATUS.md)。

**只綁 127.0.0.1、只用合成資料、身分是明文 mock；不可部署或經反向代理公開。**

## 跑法

需要 Node.js ≥22.18（內建 type stripping 與 `node:sqlite`）。在 `platform/edge-ops/`：

```sh
npm --prefix web ci
npm run demo                      # build UI，啟動 http://127.0.0.1:8787，空庫時自動 seed 3 台合成節點
npm run mock-agent -- tick        # 第一台節點送出下一筆 M0 telemetry report
npm run mock-agent -- replay      # 逐位元重送最新 report → duplicate receipt
npm run mock-agent -- offline     # demo 時鐘 +240 秒 → 全部離線
npm run mock-agent -- recover     # 第一台送出新樣本 → 恢復在線
npm run mock-agent -- reset       # 清除 ws_demo 的合成資料
```

資料存在 `.local/edgeops-demo.sqlite`（node:sqlite，套用 `backend/migrations/` 全部 migration）。要在真正的 local workerd + D1 上跑同一條鏈路：`cd backend && npm ci && npm run test:workerd`。

Vite 開發模式：`npm run start:local` 啟動 API，再 `npm --prefix web run dev`（port 5173，proxy 到 8787）。

## 這批刻意未做

真實 enrollment（token／Ed25519 proof）、請求簽章驗證與 nonce 表、Durable Object／WebSocket、R2、logs／jobs／bootstrap、真實主機採集、Cloudflare 部署。
