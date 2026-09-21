# Agent 平台範本研究與選擇

- Research date：2026-09-21 UTC
- Scope：公開 GitHub repository、README、官方架構／自託管文件與 GitHub REST metadata
- Decision：**OpenHands Agent Canvas** 為唯一主產品範本
- Implementation status：未安裝候選平台；未測試 OpenHands × Cocoon 相容性

## 1. 如何理解需求

本次「最流程」依前文理解為「最流行」。研究目標是從主流候選中挑選適合「伺服器常駐、多 agent 並行、統一 Web UI」的範本。並非建立全 GitHub 的完整排名，也不把星數最多直接等同最適合。

比較四個不同取向的候選：coding agent 工作台 OpenHands、通訊／個人與團隊 assistant OpenClaw、LLM app/workflow 平台 Dify、視覺化 agent builder Flowise。這是有目的的候選比較，不能推導市占、活躍使用者或商業成熟度。

## 2. 查詢當時的 GitHub 指標

數據直接來自各 repo 的 GitHub REST `GET /repos/{owner}/{repo}`，於本次研究時間讀取；星數與 fork 數會變動。Commit 是研究閱讀基準，不代表已選為部署版。

| 候選 | Stars | Forks | 查詢時觀察 | 對本需求的適配判斷 |
| --- | ---: | ---: | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | 390,181 | 82,065 | README 以跨通訊管道 assistant 定位，也提供 team deployment／Control UI | 很熱門，也有多 agent 相關能力；產品重心偏通訊管道與 assistant，不是本案首要的 repo/task/diff 工作流 |
| [Dify](https://github.com/langgenius/dify) | 156,707 | 24,709 | 主打 LLM app、workflow、RAG 與協作開發 | 適合建業務 agent／流程應用；不是本案最直接的 coding workspace 與 server runtime 範本 |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 88,691 | 11,669 | 目前 README 名稱為 Agent Canvas；自託管、多 backend、coding agent 與自動化 | **選定**：與本題使用者流程與 agent/runtime 分層最接近 |
| [Flowise](https://github.com/FlowiseAI/Flowise) | 55,470 | 25,034 | 查詢時 API `archived=true`，README 明示 archived | 可參考視覺化 agent builder；不選為新平台主要持續演進基礎 |

Metadata 查詢來源：[OpenClaw API](https://api.github.com/repos/openclaw/openclaw)、[Dify API](https://api.github.com/repos/langgenius/dify)、[OpenHands API](https://api.github.com/repos/OpenHands/OpenHands)、[Flowise API](https://api.github.com/repos/FlowiseAI/Flowise)。以上是 2026-09-21 快照，不保證日後打開仍相同。

## 3. 為什麼選 OpenHands

目前的 OpenHands/OpenHands 主分支已以 **Agent Canvas** 呈現。它將使用者介面與執行服務分開：Canvas 顯示對話與工作區；Agent Server/SDK 執行 agent；automation 元件處理觸發與排程。這個分層可以對應本案的「Web 控制面 + agent runtime + Cocoon 隔離環境」。

官方 [README](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/README.md) 說明可連接多個 agent backend；[架構文件](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/docs/architecture.md) 明確把執行與 sandbox isolation 排除在前端責任之外。因此參考它的操作模型，不把 Canvas 前端本身當作 VM scheduler。

這是**適配度決策**：OpenClaw 與 Dify 的星數更高。本文件不稱 OpenHands 是全球第一、使用者最多、或已在本環境驗證的最佳效能方案。

### 採用與延後

| 參考能力 | 本平台採用方式 | 階段 |
| --- | --- | --- |
| 對話與工具活動工作台 | Task workspace：對話、輸出、files/diff/artifacts 共用 run identity | MVP |
| Backend 與 UI 分離 | AgentBackend adapter，UI 只接平台 API | MVP |
| 遠端 Agent Server | 每 active attempt 對應隔離 guest 中的 server；跨 sandbox relay 必須驗證 | M0/M2 |
| 多種 agent／ACP | 先固定 OpenHands；ACP 另做能力協商與測試 | M5 |
| Scheduled/webhook automation | 先手動任務；後續以唯一 scheduler admission 建立 run | M5 |
| 多 backend 管理 | 先單節點多 run，後續多節點 inventory／placement | M6 |

本案不直接採用「browser 保存所有 backend root keys」或「agent 直接在控制面 host 任意執行」的部署方式；採 server-side adapter 與 MicroVM。這是本地設計選擇，不是對所有上游部署模式的概括。

## 4. 與 Cocoon 的對接邊界

| 元件 | 已讀到的上游能力 | 本案尚需完成 |
| --- | --- | --- |
| [cocoon](https://github.com/cocoonstack/cocoon/blob/d7dd9a698c1d55c5685c5d4b743ac1413d86e87a/README.md) | VM 生命週期、映像、快照／clone、CLI | 選定可重現版本，驗證主機／guest 模板 |
| [sandbox](https://github.com/cocoonstack/sandbox/blob/5a800317f15554400c989d9de4c5ab5c1cacf7da/README.md) | sandboxd、預熱池、guest daemon、Python/Go SDK、exec/files/port relay | Agent Server 模板、private API transport、run mapping、lease／reconcile |
| [sandbox deploy](https://github.com/cocoonstack/sandbox/blob/5a800317f15554400c989d9de4c5ab5c1cacf7da/docs/deploy.md) | Linux/KVM 部署、pool／cap／token、尺寸與升級條件 | 實測 concurrency、出站、TTL、cleanup、升級程序 |
| [gateway control plane](https://github.com/cocoonstack/gateway/blob/15616a006933f9e4cfdebda6f00c886f54efec50/control-plane/README.md) | Gateway 的 Web key／usage／billing／role 介面 | 不拿它替代 task／conversation UI；MVP 不依賴這個服務 |

此研究未找到上游承諾「OpenHands Agent Server 已原生支援 Cocoon」的證據。SDD 採用 adapter 方向，將實際整合列為 M0 hard gate。port relay 存在不等於 WebSocket／replay／pause 等完整生命週期已驗證。

## 5. 已知差異與時效

- Sandbox HTTP/Python 文件的 claim TTL 預設只有 5 分鐘，上限 24 小時；目前未確認一般續租 API。MVP 以完整 run deadline 加收尾時間申請 TTL，不能把長任務建立在預設期限上。
- Canvas repository 的 README 仍標示 beta；本案採樣自當日 default branch，不將其所有介面視為永久穩定。
- Canvas README 指向獨立 `OpenHands/typescript-client`；SDK 當日 README 則指出 canonical browser client 在 SDK 的 `clients/typescript/`。**來源有位置差異**，M0 以 pinned Agent Server OpenAPI／SDK tree 核對，不能從舊連結推定 package 路徑。
- OpenHands SDK 的「多 agent」能力不代表本案已具備規劃者／執行者協作；MVP 範圍是多個可並行、可觀察、可介入的獨立任務。
- 上游的自託管最低規格不是本平台多 VM 並行的硬體要求；本地驗收另量測。
- Flowise archived 是本次直接 API/README 的觀察；不沿用舊文章將它當成活躍維護中的主範本。

## 6. 授權與程式重用

本次新增的是原創設計文件，沒有複製第三方程式碼。已讀取的 OpenHands Canvas 與 SDK LICENSE 均為 MIT。Cocoon README 宣告 MIT；sandbox README 區分 server stack 的 AGPL-3.0 與 client SDK 的 Apache-2.0。

後續若重用程式碼／package，需針對**實際固定版本**保存 LICENSE、notices 與依賴清單；Cocoon sandbox server 維持其授權。把服務放在 HTTP 邊界外不代表其修改、部署或重新分發要求自動消失。本次不對尚未選定的整套 distribution 作授權結論。

## 7. 來源版本清單

| Repository | 研究時 default branch HEAD |
| --- | --- |
| OpenHands/OpenHands | `15e6860788121593e2eb5618e78a79a3ba732e8d` |
| OpenHands/software-agent-sdk | `856d99d48e4b11c70c5f1cab21e7830570dbc324` |
| OpenHands/automation | `4472528503d911d1e18362cbee8639d67d309614` |
| openclaw/openclaw | `017146c2b9574684a1b538a565f2592f65b18083` |
| langgenius/dify | `f7b594bf7987fccc69f6c6ece1f9e5e23ca6f47e` |
| FlowiseAI/Flowise | `9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb` |
| cocoonstack/cocoon | `d7dd9a698c1d55c5685c5d4b743ac1413d86e87a` |
| cocoonstack/sandbox | `5a800317f15554400c989d9de4c5ab5c1cacf7da` |
| cocoonstack/gateway | `15616a006933f9e4cfdebda6f00c886f54efec50` |

### 直接閱讀的主要來源

1. [OpenHands README](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/README.md)
2. [Canvas architecture](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/docs/architecture.md)
3. [Canvas self-hosting](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/docs/SELF_HOSTING.md)
4. [Software Agent SDK](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/README.md)
5. [OpenHands automation](https://github.com/OpenHands/automation/blob/4472528503d911d1e18362cbee8639d67d309614/README.md)
6. [OpenClaw README](https://github.com/openclaw/openclaw/blob/017146c2b9574684a1b538a565f2592f65b18083/README.md)
7. [Dify README](https://github.com/langgenius/dify/blob/f7b594bf7987fccc69f6c6ece1f9e5e23ca6f47e/README.md)
8. [Flowise README](https://github.com/FlowiseAI/Flowise/blob/9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb/README.md)
9. [Sandbox HTTP API](https://github.com/cocoonstack/sandbox/blob/5a800317f15554400c989d9de4c5ab5c1cacf7da/docs/sandboxd-api.md)
10. [Sandbox Python SDK](https://github.com/cocoonstack/sandbox/blob/5a800317f15554400c989d9de4c5ab5c1cacf7da/docs/sdk-python.md)
11. [Canvas LICENSE](https://github.com/OpenHands/OpenHands/blob/15e6860788121593e2eb5618e78a79a3ba732e8d/LICENSE)
12. [SDK LICENSE](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/LICENSE)

第 9、10 項是整合契約的必要對照，仍需 M0 實測；有文件不等於測試成功。SDD 中的不變量、API 路徑、狀態與效能目標均為本平台設計。
