# Portfolio

只記錄**現行**決策。被取代的條文直接刪除，歷史以 git log 為準。最後更新：2026-09-28。

## 怎麼讀

- **投入**（開發投入）：是否為這個 codebase 規劃新功能。
  - **繼續投入**：在範圍與限制內開發。
  - **維護**：不規劃新功能，只修 bug、相容性與安全問題。
  - **休眠**：不規劃新功能；投入預算的決定，不是品質判斷。在用的產品出問題時仍可修復。
  - **收掉**：只留歷史，不維護。
  - **未分級**：尚未做投入決定。
- **使用**：產品有沒有在用，只記 owner 確認的狀態（在用／沒在用／未知）。**使用與投入互不推導**：
  在用不代表要繼續開發，沒在用也不代表要停。
- **檔位**：文檔深度 A–D，只決定文件深度，不決定投入。政策見 [docs/portfolio-doc-tiers.md](docs/portfolio-doc-tiers.md)，
  分類見 [docs/taxonomy.md](docs/taxonomy.md)。C 檔的 `Dormant since` 預設 2026-09-04，除非元件 README 另有更明確的日期。
  「—」表示不在 newclear 的檔位制度內（其他 repository）。
- 進度、測試結果與 milestone 以各元件的 README、SDD、`.team/` 為準，本檔不記錄。
- `newclear/refs/` 是第三方索引，不是自有元件，不列入。

## 元件

### 繼續投入

| 元件 | 使用 | 檔位 | 範圍與限制 |
| --- | --- | --- | --- |
| `knowledge-base` | 未知 | — | 唯一 canonical knowledge store；停止擴張 schema。寫入邊界見下方「知識、文件與個人筆記」。 |
| `newclear/platform/ice-maker` | 未知 | A | 唯一 ingestion/compiler；產生真實成果，不再新增 pipeline abstraction。 |
| `kernel/personal/pif` | 在用 | — | 仍在開發，尚未確認為可用產品。 |
| `kernel/personal/clouddrive` | 未知 | — | read-only-first；只用供應商授權且受支援的 surface，不走帳密型 reverse-engineered API。 |
| `kernel/personal/relayvault` | 未知 | — | v0.2 release 需先完成 production no-overwrite cutover，並另行授權。 |
| `newclear/products/kith` | 在用 | A | 人機群聊。不復活 `labs/bee-swarm`；不擴充 `platform/fanzloud` 或 `gateways/pokercase` 的原始碼來承載房間。 |
| `newclear/platform/agent-platform` | 未知 | A | 自管多任務 agent Web 工作台，範本 OpenHands Agent Canvas，整合 Cocoon sandbox。與 `fanzloud`、`kith` 責任分開，不改動它們的實作；不是部署宣告。見 [README](platform/agent-platform/README.md)。 |
| `newclear/platform/edge-ops` | 未知 | A | Cloudflare + Host Agent 主機監控／受控操作設計；SDD + M0 契約層（TS/Go 共用向量、D1 transaction spike），無 runtime 或 live deployment。預設 monitor-only；既有 OneVPS／OneFleet authority 不變，真實主機變更另行授權。見 [README](platform/edge-ops/README.md)。 |
| `newclear/platform/signal-hub` | 未知 | A | 個人事件中樞：只負責事件、規則生成指標與投遞；不執行動作、不承載決策（決策系統與執行器另立）。不擴充 edge-ops、dim-gate、hai-taskboard、PIF 的範圍。目前僅 SDD，部署另行授權。見 [README](platform/signal-hub/README.md)。 |
| `newclear/apps/cms-scaffold` | 未知 | A | 以 Shopify 前端為參考重寫前端，後端配套演進；總綱 `docs/sdd/00-overview.md` 的切面與技術棧不變。路線圖見 [v2 索引](apps/cms-scaffold/docs/v2/README.md)。 |
| `newclear/tools/cc-quota` | 未知 | A | 採集與展示解耦；不刷新或轉存憑證，不自動調度任務。真實額度端點與 macOS launchd／Keychain 路徑尚未在目標機器驗證。 |
| `newclear/tools/codex-usage` | 未知 | A | 只做 ChatGPT/Codex 訂閱用量的單次唯讀採集：不建立模型 thread/turn、不讀出 credential、不建 scheduler／SQLite／通知；不以 API Platform usage 替代，不抓私人網頁端點。live acceptance 前不得宣稱 production-ready。 |
| `newclear/labs/mithril-research` | 未知 | A | 只做 `projecteru2/mithril` 的原始碼／文件研究、驗證設計與隔離實驗規劃；上游源碼不匯入。不是代理產品或部署授權；不復活 `systems/snail`，不擴大 `labs/eru-vps-mvp`、`kernel` 或既有 control plane。實機變更另行決定。 |

### 維護

| 元件 | 使用 | 檔位 | 範圍與限制 |
| --- | --- | --- | --- |
| `kernel/agents/codex-team-superpowers` | 未知 | — | 只修 validator、契約或相容性 bug，不擴建 dispatcher/UI。 |
| `newclear/platform/local-ocr-services` | 未知 | B | Ice Maker 的隔離 OCR adapter。`agent/t006` load-test WIP 暫停，Ice Maker 的實際 workload 證明容量不足才恢復；redistribution 前補 license review。 |
| `doc_analysis_study` | 未知 | — | evidence-bounded study corpus；只在有新研究題目時新增，不發展成第二套知識系統。 |
| `fallrising` | 未知 | — | GitHub profile map；只在 portfolio ownership 改變時同步。 |
| `kernel/personal/tgstash` | 在用 | — | 維持現狀。Tailscale-only 暫存轉移，不是備份。 |
| `kernel/personal/ts-upload` | 在用 | — | 維持現狀。 |
| `kernel/personal/ts-download` | 在用 | — | 維持現狀。 |

### 休眠

fe-review 例外：C 檔元件可以在 [fe-review](docs/fe-review/README.md) 第 2 輪，依各元件 `fe-review/DESIGN.md` 做前端修改與所需的最小解耦；
不授權新功能或 major 依賴升級。D 檔元件不進入第 2、3 輪。

| 元件 | 使用 | 檔位 | 範圍與限制 |
| --- | --- | --- | --- |
| `newclear/products/goku` | 未知 | C | 保留 `copilot`／`gemini` branch，去留待決。 |
| `newclear/products/phark` | 未知 | C | 保存 branch 是否視為被 PR #10/#11 取代，待決。 |
| `newclear/gateways/pokercase` | 未知 | C | 不加入另一套 agent orchestration。 |
| `newclear/systems/clarkq` | 未知 | C | 不加 cluster feature。 |
| `newclear/systems/snail` | 未知 | C | 保留 benchmark 歷史。 |
| `newclear/systems/ojbquay` | 未知 | C | 維持現有環境，不擴建。 |
| `newclear/systems/wotar` | 未知 | C | security-sensitive E2EE client；恢復時不能只靠 local suite 維護。 |
| `newclear/platform/fanzloud` | 未知 | C | 不投資 cloud execution layer。archive source 的 open PR #3/#4 保存決策待決。 |
| `newclear/platform/prism` | 未知 | C | Phase 0 SDD。 |
| `newclear/apps/loom` | 未知 | C | 不做 plugin/runtime backlog。 |
| `newclear/apps/flowshot` | 未知 | C | `agent/sdd-baseline` 去留待決。 |
| `newclear/specs/fleet` | 未知 | B | 只作 public contract，不發展成第二個 control plane。 |
| `kernel/infra/onevps` | 未知 | — | 見「VPS 與 fleet」邊界。 |
| `kernel/infra/onefleet` | 未知 | — | 見「VPS 與 fleet」邊界。 |
| `kernel/infra/specs` | 未知 | — | 歷史設計 corpus，保留為 reference，沒有新 feature。 |
| `kernel/infra/legacy/vps-hygiene` | 未知 | — | 只作 fleet contract 的行為參考，不得當成新產品開發；`--apply` 具 privileged／destructive 風險。 |
| `kernel/fraud/edge-decision` | 未知 | — | 與 event-policy 是同一條 fraud program，一起休眠、一起恢復。 |
| `kernel/fraud/event-policy` | 未知 | — | 同上。 |
| `journal` | 未知 | — | 舊 capture archive，唯讀；只有選定的 durable note 搬到 Knowledge Base。 |

### 收掉

| 元件 | 檔位 | 後繼或理由 |
| --- | --- | --- |
| `newclear/apps/cloudform` | D | 沒有獨特用途；只留歷史。 |
| `newclear/tools/streaming-converter` | D | 只留歷史。 |
| `newclear/examples/bite-pi` | D | 會快速過時的 demo；gateway 指引由 Pokercase 或一份短文件接手。 |
| `newclear/labs/bee-swarm` | D | 由 `kernel/agents/codex-team-superpowers` 取代。 |
| `newclear/labs/aweshore` | D | 與 Knowledge Base 重疊，已明示停止開發。 |
| `kernel/infra/legacy`（`config-center`、`crontab`、`ocmesh`、`doorkeeper`） | — | 由 OneVPS／OneFleet 取代；繼續維護只會製造雙重權威。 |
| `kernel/personal/legacy/jstgbot` | — | 由 PIF 取代。 |
| `kernel/infra/legacy/mac-in-docker` | — | 未驗證的 research draft，需要 KVM 與外部 image，另有 EULA 風險。 |

### 未分級

| 元件 | 使用 | 檔位 | 說明 |
| --- | --- | --- | --- |
| `newclear/products/hai-taskboard` | 未知 | A | Human–AI delivery control plane（Work Graph／Fake-core）開發中；`fallrising/desk` 格式的未來消費者。 |
| `newclear/platform/dim-gate` | 未知 | A | CMDB 運維自助平台前端 demo。 |
| `newclear/labs/eru-vps-mvp` | 未知 | A | live VPS MVP 實驗。 |
| `newclear/systems/mkfk` | 未知 | B | 教學／契約實作；不新增 tutorial。 |

## 重疊與 canonical 邊界

### 知識、文件與個人筆記

`knowledge-base` 是唯一 canonical knowledge store；`ice-maker` 是唯一 ingestion/compiler；`local-ocr-services` 只是隔離的
OCR runtime adapter；`doc_analysis_study` 是受限來源的 study staging area。研究結論經審核後進 Knowledge Base，不把整個
study repo 合併進去。

寫入來源的邊界：`ice-maker` 與 `doc_analysis_study` 是配套的一組，都允許自動化寫入，但輸出永遠停在候選狀態。
`knowledge-base` 不接受任何自動化來源直接寫入；每一則進 KB 的內容都要有 owner 在場的那一次決定。

`flowshot`、`loom`、`goku` 與 Knowledge Base／Ice Maker 爭奪「讀、記、整理資訊」的同一份注意力，不同時開發。

### VPS 與 fleet

`kernel/infra/onevps` 擁有 privileged host lifecycle，`kernel/infra/onefleet` 擁有 application workload lifecycle，兩者不可合併權限。
`newclear/specs/fleet` 只作 public contract，不形成第二套 runtime。`kernel/infra/specs` 是歷史設計 corpus。

### Agent 與 LLM 工具

`kernel/agents/codex-team-superpowers` 是可驗證的 workflow canonical。`agent-platform`（自管 agent 工作台）、`kith`（人機群聊）、
`fanzloud`（personal BYOS／Codex Cloud，休眠）責任分開。`pokercase` 不加入 agent orchestration。

### 個人自動化與傳輸

PIF 擁有 capture／reconcile／backup。CloudDrive 擁有 cloud inventory、annotation、transfer／verification lifecycle。
RelayVault 擁有私有檔案中繼，可作 CloudDrive 的未來 adapter；兩者可同時開發，但不重疊實作。
tgstash、ts-upload、ts-download 是 Tailscale-only 的小工具，不承擔備份或長期保存。

### Messaging 與資料基礎設施

ClarkQ、Snail、Ojbquay、Wotar 的協定不同，不硬合併；它們消耗同一份「基礎設施作品」預算，所以一起休眠。

### Fraud clean-room

`edge-decision` 與 `event-policy` 的 runtime／storage／outbox 邊界保持分離，不為減少 repo 數硬合併；portfolio 上只算一條 fraud program。
edge 擁有 request／effect admission，policy 擁有 feature resolution／evaluation。

## 下一步

1. **Knowledge Base**：在 4 條獨有 `cursor/*` branch 中選出要保留的內容，合成一份 canonical multi-model routing note，其餘標記 superseded；
   完成前不新增同題筆記。
2. **Ice Maker**：用一份真的需要的文件跑完整 ingestion → OCR（需要時）→ provenance → readable result，把一個有 citation 的成果落進 Knowledge Base。

## 待決

1. 兩個 fraud 元件是否有真實 stakeholder、資料契約或截止日？若沒有，是否在 M6 停下，並把兩條 `agent/m7-local-infrastructure` branch 標為 paused？
2. 是否保留下列未合併工作：Fanzloud open PR #3/#4、Knowledge Base 4 條 `cursor/*` note、Local OCR `agent/t006`、兩個 fraud M7 branch、
   Goku `copilot`／`gemini`、Flowshot `agent/sdd-baseline`、Bee Swarm `project-restructure`？Phark 的保存 branch 是否視為被 PR #10/#11 取代？
3. archived `config_center` 歷史中曝光的 n8n PostgreSQL／basic-auth credential 是否已輪換？repo 已 archive 不等於風險已解除。
4. 繼續投入目前有 11 項，遠超過 2026-09-05 提議的 3 條戰線上限。還要設上限嗎？要的話，上限是多少？
5. 未分級的 4 個元件要放在哪一級？
