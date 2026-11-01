# CF 工具目錄與處置建議

查核：2026-11-01 UTC（本地 11-02）。**先保留原責任與入口；下一個接入選既有 CF 資源盤點的唯讀報告。** 本輪只盤點與建議，沒有搬程式、封存 repo、查詢 CF 帳號、部署、續權或改方案。

## 範圍與來源

GitHub 連線以 owner 篩選取得 **64 個 repo：41 public、23 private；53 archived、11 未封存**。`page_size=100`、offset 0 回 64，offset 64 回空；另查 offset 100 亦空。64 個 default branch 均取得 commit、完整 recursive tree（均 `truncated=false`）及根 README，沒有讀取失敗。這是**連線可見清單完整分頁**，不是帳號所有權限或所有 CF 部署的證明。

[公開快照](evidence/cf-repository-snapshot.json)保存 41 個公開 repo 的 branch／commit／tree query ref／README blob pin、檔名訊號與計數；23 個私人 repo 的明細及來源證據只保存在受保護私人盤點紀錄。沒有把私人路徑、網域、帳號或資源 ID 複製到公開表。GitHub connector的recursive tree回應sha重複了query commit，因此記為`tree_query_ref`，不冒稱Git root-tree object SHA；審查以本機newclear物件確認此差異。

本次 newclear 來源固定在 [`053e2bcd63cedb36e463c9b8f640fd2831101f23`](https://github.com/fallrising/newclear/tree/053e2bcd63cedb36e463c9b8f640fd2831101f23)。下列相對連結供日後導航；本次判斷以此 pin 的檔案為準，元件最新狀態仍由其 SUCCESS／STATUS 負責。另讀所有 repo README 的 CF／後繼者線索，並在該 newclear pin 的產品目錄搜尋 CF 相關內容，避免只找 wrangler 檔名。

限制：未逐檔審查 64 repo 全部內容、其他分支、submodule 或 CF Console；無訊號不等於未使用 CF。未檢查隱藏／未授權 repo；沒有測試目前線上存活、有效登入或費用。先前還原工作讀 Pages 清單曾缺 scope（[歷史證據](evidence/m1-remote-restore.md)）；本輪沒有重試或補授權。既有 archived 狀態不等於其部署已停，也不是這次封存成果。

## 在哪裡找、能做什麼

`keep-in-place`＝維持原產品維護；`reference`＝只作導航／參考；`adapter`＝建議接既有介面，尚未接入。`move-candidate`／`retire-candidate`是待決定候選，不是授權。本輪 **0 個搬遷候選、0 個新封存動作**，無須為了集中導航先搬資料。

### CF runtime／應用

| 工具、用途與程式入口 | API／排程與 CF 元件 | 證據、缺口與可用入口 | 原責任／建議 |
| --- | --- | --- | --- |
| [Cloud Lab](../README.md)：節點檢查及非同步結果；`apps/control/worker/index.mjs`、`adapters/node-health/runner.py` | Command／result／usage API、獨立 bot MCP；Worker＋D1；15 分鐘 Cron 有歷史實測，公開 wrangler 不啟用 Cron | [部署證據](evidence/m1-snapshot-rollout.md)、[本機 quickstart](quickstart.md)。私人部署入口沿用原設定；human／bot窗口已過期，最後 resident 政策截至 2026-11-05T07:24:25Z，未新查 live | Cloud Lab 擁有 command／grant，runner 擁有本機 journal；**keep-in-place** |
| [Edge Ops](../../edge-ops/README.md)：fleet／node 監控 demo；`backend/src/worker.ts` | `/agent/v1/enroll`、`/agent/v1/telemetry`、`/api/v1/nodes` 及 metrics；Worker＋local D1；未配置 Cron | [STATUS](../../edge-ops/docs/STATUS.md)明示 mock、未部署；[本機入口](../../edge-ops/docs/DEV-MOCK.md)。handler 拒絕非 demo／非 loopback；真 collector／身份未接線 | Edge Ops 保留 telemetry／enrollment 設計責任；**reference**，具體比較見下表 |
| [Kith](../../../products/kith/README.md)：私有房間與人機協作；`worker/index.ts` | 房間／訊息／MCP／runner API；Worker、D1、KV、R2、SQLite DO；wrangler `0 3 * * *` 對應 scheduled handler | [SUCCESS](../../../products/kith/SUCCESS.md)保留歷史工程證據，真 provider／CLI 主線仍待驗；本輪未核對部署或 Cron 實際啟用 | Kith 擁有 room seq、membership、replay、provider及原生 runner；**keep-in-place**，先導航 |
| [Spring Pool](../../spring-pool/README.md)：不可變腳本版本、pin runbook、Markdown 匯出；`web/src/index.tsx`、`api/` | Hono SSR Worker→service binding→Rust/Wasm Worker／D1；[API契約](../../spring-pool/contracts/openapi.json)；未配置 Cron | [SUCCESS](../../spring-pool/SUCCESS.md)：本機／CI旅程有證據，受 Access 保護 staging 待驗；[quickstart](../../spring-pool/docs/quickstart.md) | 原產品掌握版本與 pin；**keep-in-place**。它存腳本文字，**不執行腳本**，不與 Cloud Lab runner 合併 |
| [Virtual Office Lab](../../../labs/virtual-office-lab/README.md)：agent 狀態投影；`src/worker.mjs`、CLI | `GET /state`、`POST /report`；Worker＋SQLite DO；命令 wrapper heartbeat，不是 CF Cron | [SUCCESS](../../../labs/virtual-office-lab/SUCCESS.md)：local workerd、CLI與文字 fallback 已有分段證據；真 agent hook／公開部署／完整 3D 主線未完成 | 原 producer 掌握執行、Office只呈現；**reference**，未把投影當 agent 操作權威 |
| 私人筆記／提問工作台（P-NOTES） | Worker＋D1＋Access；筆記 API、逐篇授權 GET-only agent client；模板未配置 Cron | 私人固定來源 README 記錄受保護部署及部分雲端瀏覽器實證；完整矩陣未完成，本輪未測 live；實際程式與操作手冊見私人盤點 | 原應用保留內容、版本、逐篇授權；**keep-in-place**，不搬私人知識或共用人類 cookie |

### CF 運維與相關系統

| 工具、用途與程式入口 | API／排程模式 | 證據與缺口 | 原責任／建議 |
| --- | --- | --- | --- |
| 私人 CF inventory（P-INVENTORY）：資源用途與 drift | 現有 Python CLI 僅發 GET，讀 zones、Workers、domains、Pages、tunnels、Access；`--check` 非零呈現 drift／必查區段不可讀；無內建排程 | 已讀固定來源 README／SUCCESS／實作；目前輸出文字，沒有穩定 JSON envelope／觀測時間；SUCCESS的真帳號 qualification待驗。它不是 D1／R2 用量或帳單 API | 原工具擁有 desired／actual 比對；**adapter，選為下一項能力**。不另寫 provider inventory client |
| 私人 edge review tool（P-EDGE） | 本機 `validate`／`render-plan`／`render-origin`；無 provider client、credentials 或 apply | 固定來源 README明列 configuration-only；不能當已部署的 CF edge controller | 原基礎設施規格維護者；**reference** |
| 私人 host／workload manager（P-HOST） | 服務 lifecycle、明確 apply 的 Tunnel／DNS／Access入口；不是 Worker runtime | 已封存前身 README 指向原私人後繼者；本輪未重驗後繼者完整實作或 live caller | 原 manager 保留 host／workload／ingress寫入權；**reference**，將來只接所需 read model |
| [Fleet](../../../specs/fleet/README.md)：Compose工作負載及服務目錄 | Go／SQLite控制面與 outbound agent；[Cloudflare相關程式](../../../specs/fleet/SUCCESS.md)為 Tunnel／Access bootstrap，非 CF 託管執行器 | SUCCESS有真 Docker lifecycle／恢復證據；CF Access瀏覽器邊界待驗；`specs/`路徑不代表只有規格 | Fleet掌握 workload desired state與reconcile；**reference**，不與 command store做雙重controller |
| [Fanzloud](../../fanzloud/README.md)、[Agent Platform](../../agent-platform/README.md)、[Workforce](../../agent-workforce/README.md) | 外部原生 run／sandbox／binding；Fanzloud保留 [Tunnel/VNC歷史來源](../../fanzloud/docs/legacy-vnc_lab/README.md)；不是整個平台能直接搬進Worker的證據 | 各自 SUCCESS 是驗收權威；本輪未重驗執行端與 live整合；Cloud Lab目前無agent adapter | 原平台掌握run／stop／cleanup；**reference**，第二項能力本輪不選它 |
| [Signal Hub](../../signal-hub/README.md)與[HAI Taskboard](../../../products/hai-taskboard/README.md) | 事件read model／工作驗收；不是已部署CF元件的證據 | 沿原SUCCESS；本輪只保留整合導航 | producer及工作系統保留事件／Done權威；**reference** |

### 實驗、已封存或第三方來源

| 來源 | CF關聯／API與Cron | 證據、缺口與處置 |
| --- | --- | --- |
| [Open Compute](../../../labs/open-compute/README.md) | 自架Workers／D1／Workflow runtime實驗，不是託管CF帳號 | 原lab保留驗證；**reference**，不可代替Cloudflare部署證據 |
| [streaming-converter](../../../tools/streaming-converter/SUCCESS.md) | Bash／FFmpeg、可選rclone上傳R2；不是Worker或CF Cron | 元件已retired；舊獨立repo亦已archived；**reference**，不恢復維護或重複封存 |
| [Cloudflare-Accel保存索引](../../../refs/Cloudflare-Accel/README.md) | `_worker.js`下載／鏡像代理，可部署Workers／Pages；本輪未見Cron或owner部署證據 | GitHub metadata確認fork自fscarmen2、已archived、GPL-3.0；pin見公開快照。**reference**，非自有運維模組 |
| [Magpie網站來源](https://github.com/fallrising/magpie/tree/40b36247d281699a0bc1ba36648c9de80dedcd63/site) | `worker.js`提供版本／下載／partners等API，`wrangler.jsonc`宣告KV及15分鐘Cron | fork自yetone/magpie、MIT；這是上游網站設定，**不證明owner帳號部署**。**reference**，不是Cloud Lab bot或agent控制面 |
| [Peach](https://github.com/fallrising/peach/tree/90dd23fb1566e0a7fcecddf2a87652e111822de2) | cloudflared包裝、瀏覽器來源相容性；未找到自有Workers manifest | fork自peach-mitao/peach、AGPL-3.0；**reference**，不把使用Tunnel當CF原生工具 |
| [Bee Swarm](../../../labs/bee-swarm/README.md)與其他內容提及 | Bee Swarm部署指南／simulation含Tunnel／Pages；Aweshore的Qwik模板提可選CF；Pokercase描述反向代理安全 | **reference**，不是託管部署。另有browser-fingerprint、mithril-research、retro-economy、history-atlas、phark、mkfk的內容命中；未因字詞命中提升成CF應用 |

## Edge Ops 與 node-health：重複在哪、不能替代什麼

比較的是固定來源的實際程式與待實作契約，沒有測試重跑或caller全量調查。

| 邊界 | Cloud Lab node-health | Edge Ops當前程式／設計 | 決定 |
| --- | --- | --- | --- |
| 收集 | 真Python collector：load1、CPU核數、根檔案系統可用比例；固定healthy判斷 | S0 mock上報；[telemetry schema](../../edge-ops/contracts/schemas/telemetry-report.v1.schema.json)含CPU busy、load1/5/15、memory、swap、mounts、disk I/O、net等，Go目前是契約驗證而非真collector | 只有load／disk概念重疊，CPU核數不等於CPU利用率；不抽共用collector |
| 觸發／傳輸 | API／bot／Cron下command，由runner claim後回報；單槽及journal | mock agent主動push telemetry，boot／seq／sample window去重 | command不能冒充telemetry stream；不合併狀態機 |
| 畫面／歷史 | command、結果artifact、未知、stale、應用額度 | fleet/node/detail、CPU history；心跳、freshness與歷史查詢有獨立語義 | 看板外觀相似不等於資料等價；保留歷史設計 |
| 身份／權限 | Access＋HMAC／scoped grant；有具名歷史live證據 | S0明文mock身份，僅loopback；M0 Ed25519／enrollment契約存在但未接真HTTP路徑 | 不共用token或直接公開demo |
| 未完成責任 | 不做主機註冊、完整OS時序監控、任意shell | 真enrollment／collector、DO／R2、jobs／logs／bootstrap等仍待完成；S0相關路徑回501 | 不宣稱Cloud Lab覆蓋Edge Ops全部需求 |
| 維護代價 | 一套已運作過的固定recipe與journal | 另一套TS／Go契約、React畫面、telemetry store與未完成接線 | 未量測工時；可見重複維護面已足以避免同時推兩套live健康入口 |

**具體建議：**日常「這台機器負載／磁碟是否異常」繼續使用Cloud Lab；Edge Ops維持原地參考與歷史驗證，本計畫暫不推進其第二套live監控。將來真需要多機fleet、CPU／memory時序或enrollment，再由該需求決定接Edge Ops read model或擴充現有觀測；不現在複製其UI／auth／資料表。

這不是Edge Ops退役批准。尚未有完整caller／資料／來源license與後繼覆蓋審查，不滿足[遷移G5](migration.md)；不移動原契約／證據，不更改它的STATUS或其他團隊計畫。

## 下一個有界接入：資源盤點報告

選P-INVENTORY，因為它已經有provider GET與desired比對，能回答「我有哪些CF服務、哪些不在清單、哪些讀不到」。這補上目前只有機器load／disk的入口；**資源存在、drift、服務健康是三個不同結論**，報告不把存在的Worker顯示成健康。

1. 先在原工具加入一個小型、版本化JSON輸出：source revision、觀測時間、各區段readable／unknown與原因、資源摘要及drift；保留原文字CLI與唯一desired來源。不得另造同步器、寫入API或把缺權區段當空清單。來源現有pagination仍需在接入時核對端點語義，不能沿用本輪GitHub分頁證據替代CF分頁驗證。
2. Cloud Lab只讀這份有界報告，提供與node-health並列的唯讀入口；資料只在受保護部署保存。先手動一次收集，不新增Cron、generic plugin registry或provider憑證副本；不要解析不穩定人類文字當契約。
3. 必要負面測試涵蓋過期／無法讀取／部分資料／錯誤版本，及原CLI相容性；在既有授權允許下取得一次真實報告並顯示source／time／error即停止。Pages缺scope可明示unknown，不為全綠自動擴權；新的live發布或權限變更仍須具體方案。保留Workers Free，不新增付費產品。

這是下一任務的範圍建議，本輪尚未新增JSON介面、接入看板或完成第二種能力。A的日常授權與本報告分開處理，無需再安排固定兩小時人工驗證窗口。
