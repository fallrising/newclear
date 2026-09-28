# Edge Ops

> **Portfolio doc tier: A** — [Policy](../../docs/portfolio-doc-tiers.md) · [Portfolio](../../PORTFOLIO.md) · [Quickstart](docs/quickstart.md)

Cloudflare 控制面 + Host Agent 的主機觀測與受控作業平台。**目前交付 S0：前端／後端／假 Agent 的本地 monitoring-only 垂直切片。沒有真實主機採集、認證或雲端部署。**

```text
獨立 Mock Agent CLI → HTTP → 共用 Worker handler → Store / SQLite
                                                  ↓
React ← HTTP Query API ← 持久化資料與新鮮度判斷
```

前端不是靜態 fixtures：它只讀 API。Mock CLI 產生合成節點與指標，資料經 HTTP 寫入 SQLite；重啟後保留。相同 Worker handler 另有 Wrangler local D1 驗證入口，兩種 runtime 證據分開記錄，不能把 Node SQLite 測試稱作 workerd 驗證。

## 現有能力

| 區塊 | S0 實作 | 尚未實作 |
| --- | --- | --- |
| React / TypeScript UI | 清單、搜尋、詳情、CPU 圖表、原始樣本、回執、手機布局、API 故障提示 | 登入、WS 推送、logs/jobs/bootstrap |
| TypeScript Worker API | 合成註冊、指標上報、去重、歷史、新鮮度、工作區查詢隔離、大小／容量限制 | 真實 enrollment、Access JWT、Ed25519、DO/R2、告警通知 |
| Mock Agent CLI | seed/tick/replay/offline/recover/reset，真正的本地 HTTP 請求 | Go Agent、OS 採集、systemd、主機操作 |
| Persistence | SQLite 實際持久化 + D1 binding adapter / migration | 雲端部署、計費量測、長期可靠性驗收 |

只允許 `node_demo01..10` 的合成資料；所有節點 `host_authority=none`、`mode=monitor-only`。假身分標頭不是登入驗證，不能接入真實節點、公開 Tunnel 或 production。Worker 預設 disabled，只有明確 demo + loopback 可用；未實作的控制通道回 501。

## 開始

完整命令、測試和限制見 [quickstart](docs/quickstart.md)。目前已執行的本地證據：21 項 Node／SQLite／HTTP 測試、共用契約檢查、後端型別檢查。React 建置、Playwright 與 workerd 的實際 CI 結果以 [STATUS](docs/STATUS.md) 與 PR checks 為準，不以測試檔存在宣稱通過。

## 文件

- [S0 scope / contract amendment](docs/S0-MOCK-CHAIN.md)：這次 owner 選定的 mock 切片，不等同完整 M0/M1 驗收。
- [SDD](SDD.md) 與 [詳細 SDD](docs/sdd/README.md)：長期架構、前後端／Agent／bootstrap／安全／容量。
- [STATUS](docs/STATUS.md)：唯一進度權威；[本地證據](docs/evidence/S0-LOCAL.md)。
- [DEVELOPMENT_PROMPT](DEVELOPMENT_PROMPT.md) 與 [AGENTS](AGENTS.md)：後續 session 入口。

## 平台邊界

不接管 OneVPS host lifecycle、OneFleet workload lifecycle、dim-gate CMDB 或 agent-platform 的 LLM/Cocoon 執行。SDD 中的操作與初始化仍需後續明確授權及完整安全 gate。沒有命令執行器、SSH、root 或 Docker socket。

新內容沿用根 MIT；未匯入上游 CF-Server-Monitor 程式碼。套件鎖檔是本 repository 固定版本的工具鏈快照，來源及未完成的依賴精簡見 S0 文件。
