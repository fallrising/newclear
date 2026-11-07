# 來源與證據界線

查核日期：2026-10-26。公開 repository 基準：`65bbadb7659437e8a14f029015313c6f5277ce35`。來源檔是設計／實作盤點依據，不代表本次重跑其測試或觀測線上服務。可變的元件狀態以最新 SUCCESS 為準；本表保留 M0 判斷的固定來源。

最新的2026-11-01盤點與處置見[CF工具目錄](tool-catalog.md)；本頁保留M0固定來源，不能當最新GitHub完整清單。

## 既有元件

| 來源 | 固定版本 | 使用範圍 |
| --- | --- | --- |
| Taxonomy | [文件](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/docs/taxonomy.md) | platform 分類與公開 repo 的目錄慣例 |
| Edge Ops | [SDD](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/platform/edge-ops/SDD.md)／[SUCCESS](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/platform/edge-ops/SUCCESS.md) | D1／DO 分工、monitor-only、host authority、目前契約／mock 邊界 |
| Kith | [v2 decisions](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/products/kith/docs/v2/10-decisions.md)／[SUCCESS](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/products/kith/SUCCESS.md) | room/replay、模型工具及 runner 邊界；真 provider 整合仍 pending |
| Agent Platform | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/platform/agent-platform/README.md) | native run／sandbox 的既有責任，不從 mock 推導完整 MVP |
| Agent Workforce | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/platform/agent-workforce/README.md) | binding／准入／協調及外部 Done 權威 |
| Signal Hub | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/platform/signal-hub/README.md) | 事件、freshness、投遞及看板；不作操作決策／執行器 |
| Fleet | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/specs/fleet/README.md) | workload contract／Cloudflare ingress 的來源 |
| HAI Taskboard | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/products/hai-taskboard/README.md) | 外部工作驗收的整合候選 |
| Open Compute | [README](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/labs/open-compute/README.md) | 自有 runtime 恢復實驗，不能替代 CF live qualification |
| Cloudflare-Accel | [保存索引](https://github.com/fallrising/newclear/blob/65bbadb7659437e8a14f029015313c6f5277ce35/refs/Cloudflare-Accel/README.md) | 上游副本保存；不納為第一方程式 |

私人候選只在公開文件抽象為角色。來源程式、歷史、授權及敏感資料必須在遷入前另審；此文件不公開私人 inventory 或推論部署狀態。

## Cloudflare 官方文件

以下是查核當日的能力與限制參照，不固定服務版本、方案資格或價格；實作前重查相關限制。Cloud Lab 的責任分工是本專案設計判斷。

| 文件 | 支持的設計依據 |
| --- | --- |
| [Workflows](https://developers.cloudflare.com/workflows/) | 多步驟、持久等待與重試；不推導外部副作用 exactly-once |
| [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | 至少一次投遞，因此 command／event 需要去重 |
| [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) | 入口保護選項及 Worker 層級政策的 WebSocket 限制 |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Worker 有資源／執行限制，不把 HTTP request 當無限期背景 job |
| [Tunnel](https://developers.cloudflare.com/tunnel/) | 外部服務經出站連線接入；身份／操作授權仍獨立 |
| [Containers](https://developers.cloudflare.com/containers/)／[Sandbox](https://developers.cloudflare.com/sandbox/) | Linux 執行能力候選；本案尚未驗證 CLI／持久性／成本 |

沒有在 M0 呼叫 Cloudflare 帳號 API、建立資源、試跑模型或測試上述產品。介面設計不可引用官方功能介紹當作本案部署證據。
