# Agent Workforce

> **Portfolio doc tier: A（設計階段）** — 本次投入為 SDD 與首條真實場景的驗收設計。
> [Quickstart 與前置條件](docs/quickstart.md) · [文件政策](../../docs/portfolio-doc-tiers.md) · [Portfolio](../../PORTFOLIO.md)

把既有 AI agent 產品組成可持續工作的數位工作者：每個工作者有穩定身分、收件匣、職責、可使用的帳號與資源；按工作選擇原生 CLI、SDK、agent server 或 API，並在程序停止後保留可接續的工作與成果。

**狀態：SDD-only。** 已定義框架與驗收要求；沒有 controller、worker daemon、adapter、schema 套件或可部署服務。官方文件中的能力不等於指定帳號、版本或機器已驗證。所有 runtime／整合／長時間驗收均待執行。

## 從哪裡讀

| 文件 | 回答的問題 |
| --- | --- |
| [SDD](SDD.md) | 身分、帳號、資源、訊息、調用、會話與長任務如何合作？ |
| [產品能力與接入條件](docs/provider-capabilities.md) | Codex、Claude Code、Antigravity、Grok、Cursor、OpenCode、DeepSeek 分別怎麼接？ |
| [第一場景](docs/first-scenario.md) | 如何讓兩種原生 agent 合作處理一張工程工單並交付可審查成果？ |
| [驗收與證據](docs/verification.md) | 哪些需要文件核對、假測、真實 CLI/API、整合及恢復證據？ |
| [Quickstart](docs/quickstart.md) | 現在能做什麼，什麼條件滿足後才開始實作與試跑？ |

## 定位與邊界

Workforce 擁有跨產品的工作者／帳號／資源綁定、調用准入、持久訊息與 execution coordination。它透過外部 `work_ref` 接收已授權工作，交付結果與證據；工作目標、驗收與 Done 仍由原有工作系統決定。

| 相鄰元件 | 保留的責任 | 本項目的關係 |
| --- | --- | --- |
| [Kith](../../products/kith/README.md) | 人類與 agents 的房間、訊息歷史與顯示 | 未來 channel adapter；聊天 replay 不變成工作佇列，個人訂閱喚醒規則保持 |
| [Agent Platform](../agent-platform/README.md) | 隔離執行、sandbox 與其 Run 生命週期 | 未來可選 ExecutionBackend；原有 MVP 路線及驗收不變 |
| [HAI Taskboard](../../products/hai-taskboard/README.md) | Work Graph、review、evidence、完成條件 | 可選工作／交付 adapter；目前 Fake-only 邊界保持 |
| 外部 SaaS 與資源管理 | 帳號、workspace、權限與實際資源生命週期 | 使用有限的 ResourceBinding／OperationGrant，不複製帳號管理後台 |

第一條流程先固定 **Codex native writer＋Claude Code native reviewer**。OpenCode＋DeepSeek API 是下一條能力擴展；所有品牌都是可替換 route，職責不由品牌永久決定。第一場景的停止點是可審查成果與已授權的 Draft PR，部署及後續任務另行決定。

## 目前交付與下一道門檻

本次交付的是設計文件、官方來源能力表、交互圖及 16 項可追溯驗收條件。後續先實作離線 registry／admission／inbox/outbox 契約，再驗證兩個原生 route；沒有必要先建立六個獨立人類 SaaS 帳號或把六個產品全部串通才開始。

技術選擇以單一 owner、單一 controller、SQLite 交易式狀態與可替換 worker backend 為首版設計。語言與套件在 M1 開始時選定；本輪不新增空白 code scaffolding 或基礎服務。
