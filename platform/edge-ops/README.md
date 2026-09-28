# Edge Ops

> **Portfolio doc tier: A (active design)** — [文件政策](../../docs/portfolio-doc-tiers.md) · [投入決策](../../PORTFOLIO.md) · [quickstart／目前阻擋](docs/quickstart.md)。

以 Cloudflare 為控制面、以主機常駐 Agent 為資料面，提供多機監控、選定日誌、受控任務與可選初始化能力。`edge-ops` 是本次採用的工作名稱；不是 CF-Server-Monitor 的 fork，也不是 LLM agent 執行平台。

**目前只有 SDD 與 M0 契約層（strict JSON、請求／批准／註冊簽章、TS 與 Go 共用向量、D1 transaction spike），尚無可部署的前端、Worker、Agent、安裝器或雲端部署。** 文件中的 API 路徑、配額策略與驗收目標仍是待實作契約，不能當成已可使用功能。此階段不授權登入或變更任何真實主機。

## 三條實作線

| 工作線 | 責任 | 第一個交付切片 |
| --- | --- | --- |
| Frontend | 主機清單、健康與新鮮度、圖表、日誌、任務、審批及稽核 | 使用契約 fixtures 的唯讀主機面板 |
| Backend | Workers API、身分與授權、D1 狀態、DO 通知、R2 物件 | 一台 Agent 註冊、上報、查詢、離線判斷 |
| Agent | 非 root 指標採集、有限緩衝、選定日誌、可選執行器 | Linux/systemd amd64、arm64 的唯讀探針 |

預設 `monitor-only`；日誌是獨立 opt-in；操作能力還須在主機安裝與啟用獨立執行器。**無入站監聽埠，不等於沒有遠端控制風險。** 一旦允許操作，就必須滿足獨立簽署、主機本地政策、不可變腳本與執行證據等邊界。

## 閱讀入口

- [SDD 總綱](SDD.md)：產品範圍、架構、責任歸屬、優先級與設計決策。
- [詳細設計索引](docs/sdd/README.md)：前端、後端、Agent、image/bootstrap、契約與驗收。
- [初始化與業界做法](docs/sdd/04-bootstrap-and-images.md)：Packer、Terraform、cloud-init、SSM／VM Agent／OS Config 的分工。
- [狀態與下一步](docs/STATUS.md)：本專案唯一的進度權威；不把規格完成當成產品完成。
- [契約](contracts/README.md)：strict JSON、簽署位元組、向量、狀態機、OpenAPI／JSON Schema；[quickstart](docs/quickstart.md) 有離線驗證命令。
- [來源](docs/SOURCES.md)：固定上游 revision、官方文件與研究限制。
- [後續開發入口](DEVELOPMENT_PROMPT.md)及[開發約定](AGENTS.md)。

## 與既有專案的邊界

`dim-gate` 可透過未來 adapter 顯示本專案的主機觀測與任務狀態，現有 demo 不因本 SDD 變成 live。`agent-platform` 繼續擁有 LLM/Cocoon 任務執行；`specs/fleet`／OneFleet 繼續擁有 workload lifecycle。本專案不部署應用、不接管 Docker socket、不另建 CMDB。

既有 OneVPS 管理的主機使用 `host_authority=external`；Edge Ops 不競爭寫入主機設定。只有明確指定由 Edge Ops 管理的獨立測試主機，才可在後續授權階段使用其初始化與操作能力。

## 授權

新撰寫內容沿用 repository 根目錄 MIT。上游只作概念與需求研究，沒有複製程式碼、安裝腳本、UI 或圖片；未來引用第三方程式碼須另做版本及授權審查。
