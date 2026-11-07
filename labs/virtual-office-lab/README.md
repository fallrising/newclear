# Virtual Office Lab

把多個 Agent 的工作狀態投影成公開、隱私最小化的虛擬辦公室。

**目前：設計＋CLI＋Workers/SQLite Durable Object 整合骨架，不是已完成的 3D 網站。**
主線、驗收及缺口以 [SUCCESS.md](SUCCESS.md) 為準；未部署、沒有 usable tag，也不宣稱真實 Grok/Codex/Claude/Cursor 接入已驗收。文檔檔位未分級。

## 本次交付入口

| 需求 | 檔案 |
| --- | --- |
| 可重用建立流程、狀態機、3D 佈局、安全與產品邊界 | [SDD.md](SDD.md) |
| 完整 office-report 腳本 | [bin/office-report](bin/office-report)、[實作](bin/office-report.mjs)、[API 與用法](docs/API.md) |
| Cloudflare Workers 極簡後端骨架 | [Worker/DO](src/worker.mjs)、[核心](src/core.mjs)、[設定](wrangler.jsonc)、[公開名冊](roster.json) |
| 可直接貼給 Grok Bot 的完整提示詞 | [prompts/grok-bot.md](prompts/grok-bot.md) |
| 設定、重啟、真實接入與公開部署關卡 | [RUNBOOK](docs/RUNBOOK.md) |
| 已跑／未跑的證據與進度 | [驗證紀錄](docs/evidence/m0.md)、[任務板](docs/tasks/BOARD.md) |

## 本機唯讀頁面

啟動本機 workerd 後，執行 `npm run preview`，開啟 `http://127.0.0.1:8790`。提供狀態文字清單、過期／斷線提示與安全文字呈現；[設定與證據範圍](docs/DASHBOARD.md)。尚無 3D 場景，不代表完整產品可用。

## 前端呈現規則（尚無 3D UI）

[`presentation.mjs`](docs/PRESENTATION.md) 提供八狀態、過期警示、雙向協作與夜間 overlay 的共用純函式。未實作 renderer，不能以此代替瀏覽器驗收。

## 命令生命週期 adapter（開發中）

新增 [`office-run`](docs/LIFECYCLE.md)：Agent 明確執行命令時上報 terminal → done/error，不傳命令與輸出。這不是原生宿主 hook，也尚未通過完整 AC-07／瀏覽器驗收。

## 不需安裝依賴的本機入口

```sh
cd labs/virtual-office-lab
npm run check
npm test
./bin/office-report grok coding "進行程式開發" --task code --dry-run
```

Node >=22。核心和 CLI 沒有第三方 npm runtime 依賴。要啟動真正 local Workers，依 RUNBOOK 使用固定 Wrangler 4.156.0；它需要可下載依賴的網路，與純 Node 契約測試不同。

## 三個刻意設計

1. **不再做一個 Agent 平台**：HAI 等系統仍是任務、執行與驗收權威，office 只有顯示與 metadata 上報。
2. **不相信自由文字清洗能保密**：本機摘要最多80字，但不上傳；server 只接受 enum，生成固定公開描述。名冊與活動 metadata 仍需經 owner 同意公開。
3. **不把動畫當成真實接入**：demo、測試 HTTP、真正 Agent hook、雲端持久化和瀏覽器驗收各有獨立證據；畫面漂亮不代表 Agent 正在做事。

授權沿用 repo 根目錄 MIT。未匯入第三方程式或素材。
