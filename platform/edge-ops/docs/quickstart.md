# S0 本地 Mock Quickstart

只用合成資料，不要部署／公開 Tunnel。建議使用 repo CI 相同 Node 24.18.0；無依賴 core 已在 Node 22.16.0 執行。React／Wrangler 精確版本見各 package.json 及 lockfile。

## 一條操作路徑

在具有 npm 網路的開發環境中：

```sh
cd platform/edge-ops
npm --prefix web ci
npm run demo
```

開啟 `http://127.0.0.1:8787`。`demo` 會先 build React，啟動共用 Worker handler 的 Node host，只有空庫時才呼叫獨立 mock Agent seed：3 台、36 筆。資料保存在 component `.local/edgeops-demo.sqlite`；重啟不自動清空。

目前此整合啟動命令的 browser/build 驗證以 PR CI 和 [STATUS](STATUS.md) 為準。本地容器已驗證 core/HTTP，因 DNS 限制尚未安裝 UI packages，不將本段當成當地已跑過完整 browser 的聲明。

另開終端，在相同目錄：

```sh
npm run mock-agent -- replay
npm run mock-agent -- offline
npm run mock-agent -- recover
npm run mock-agent -- tick
```

replay 不增加樣本；offline 讓 demo 時鐘前進4分鐘；recover 只讓第一台送出新樣本，其他兩台仍離線；tick 再送新值。UI 兩秒讀一次 API，沒有前端假資料 fallback。點主機可看圖表、樣本時間與持久化 request ID。

需要清除測試資料時才執行：

```sh
npm run mock-agent -- reset
npm run mock-agent -- seed
```

這只清除隔離 demo DB。CLI 不接受公網 URL。改本地埠時 server 用 `PORT`，CLI 用 `DEMO_URL=http://127.0.0.1:<port>`；production 不支援。

## 不需安裝依賴的 core 驗證

```sh
npm run check
npm run start:local
```

第一個命令跑契約檢查與21項 Node/SQLite/HTTP tests。第二個只啟動 API及已有 built UI；沒有 web/dist 時 UI 顯示未建置，不會假造成功頁面。另開終端可直接 mock-agent seed。這些 core 命令已在本地執行驗證。

## 前端開發與 browser tests

```sh
npm --prefix web run dev
# Backend remains npm run start:local, on 127.0.0.1:8787.
# Vite dev frontend: http://127.0.0.1:5173 (API proxy).
npm --prefix web run build
web/node_modules/.bin/playwright install chromium
npm run test:browser
```

browser tests 會自行啟動 port8787 的隔離 DB，因此先停止手動 demo，避免埠衝突。CI使用 `--with-deps chromium` 安裝系統依賴；本地不自動要求 sudo。截圖/trace在web/test-results與playwright-report。

## 真正 Cloudflare runtime 的本地檢查

```sh
npm --prefix backend ci
npm --prefix backend run typecheck
npm --prefix backend run test:workerd
```

test:workerd 只操作 `--local` D1／workerd、測試埠8788。沒有 CF登入、API token、遠端資料庫或 deploy。手動使用可先 `npm --prefix backend run db:migrate:local`、再 `npm --prefix backend run dev`（8787），然後配 Vite 前端及 mock CLI。

**不能把假身分改成一個共享 secret 就當 production-ready。** 完整安全／相容／主機 gate 仍見 SDD、S0範圍與STATUS。
