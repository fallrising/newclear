# Edge Relay

**通用、可替換部署平台的反向應用通道。現況：SDD-only，沒有可執行服務、公開端點或部署。**

先讀 [SUCCESS.md](SUCCESS.md) 確認驗收與缺口，再讀 [SDD.md](SDD.md)。本次只交付設計；不代表 runtime、安全性或低成本已實測。

核心套路：**端點主動連出 → 經授權的雲端路由 → 有界多工串流 → 本機服務 adapter；通知走獨立 side channel。**

借鑑 Alma Relay 的連線方向與 CF Durable Object 分片方式，不沿用 Alma 的配對碼、wire protocol、API、App 或 APNs 整合。通用不代表沒有協定：本項目需要自己的版本化 transport contract，但不解讀上層業務。

| 層 | 責任 | 不負責 |
| --- | --- | --- |
| Endpoint Connector | 主動 WSS、裝置身分、本機服務 allowlist、取消與流控 | 任意 SSH、shell 或內網掃描 |
| Relay Core | 已授權端點路由、連線世代、有界通道 | Alma、Agent 排程、模型推論、工作資料庫 |
| Cloudflare Driver | Worker ingress + 每個目標端點的 Durable Object | 保證免費、離線工作執行、任意 TCP/UDP |
| Service Adapter | HTTP request/response、SSE、WebSocket 對接 | 將業務重試與交易語義交給 relay |
| Notification Adapter | ntfy、Bark、webhook 的最小化提醒 | 保持 iOS 背景 socket、喚醒電腦、取代資料通道 |

## 文件入口

- [SDD 與里程碑](SDD.md)、[驗收契約](SUCCESS.md)、[協作規範](AGENTS.md)。
- [文件索引](docs/README.md)：[通道協定](docs/protocol.md)、[安全與配對](docs/security.md)、[通知](docs/notifications.md)、[驗證與運維計畫](docs/verification-plan.md)、[來源與決策](docs/sources-and-decisions.md)。
- [任務認領](docs/tasks/BOARD.md)；本次只做 M0。未授權 M1 實作、部署或合併。

## 邊界

CF-first 不等於 CF-only；Node relay 是後續相容性目標，不是已實現功能。首個可用主線包含 E2EE 與真 CF、真手機通知驗收；在此之前，只有明示的 trusted-relay 合成資料實驗可以暫用逐跳 TLS。純瀏覽器 client、原生手機 client、CLI 的安全 bootstrap 不可混為一談。

本案不建新的通用任務排程、事件庫或運維平台。既有 `cloud-lab`、`edge-ops`、`signal-hub` 可作未來消費端，整合尚未授權與驗證。
