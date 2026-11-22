# Cloud Lab 既有能力與期限對帳

對帳日期：2026-11-22 UTC。這是固定來源的比較，不是新的 live 查核、平台規格或安裝方案；狀態權威仍是 [SUCCESS](../SUCCESS.md)。既有 CF inventory 已交付，CA 多VPS telemetry 仍未實作。完整主線維持 incomplete、usable_tag 維持 none。

## 來源與閱讀方式

公開來源固定於 newclear `1f855489328736a2578bb0c9e7d76e688b4f5bf8`；與原規劃 `2aa21f10b53ecaeb079279b6531bbb47a103e937` 比較，Cloud Lab／Edge Ops 相關內容無差異。下面「歷史」表示來源記錄當時實測，不代表本輪重跑或現在可用；「提案」不代表現有 API。

| 代號 | 固定來源／原驗收 | 本次用途 |
| --- | --- | --- |
| C1 | [Cloud Lab SUCCESS][c1]、[README][c2]；IR-01～04、MC-01～03、ML-01～04、CA-01～03、原 AC-01～08 | 里程碑與資格分開；保留原 AC |
| C2 | [ML 上線證據][ml]；ML-01～04 | 上線內容、首報、scope 與期限的歷史回讀 |
| C3 | [CA agent 設計][ca]；CA-02／03 | 已有 runner 與未實作多機通道、下一個具名切片 |
| E1 | [Edge Ops SUCCESS][es]、[README][er]；AC-01～04 | 契約／loopback mock 與真主機缺口；不移轉 authority |
| P-CF | 私人 producer 的 SUCCESS／README；原 AC-01／02、JSON／MCP、事件投影及 sender 切片 | 私人固定來源已由 lead 讀取；公開只記角色與結論，完整 SHA／路徑／差異留私人 P04 來源帳本 |
| P-HOST | 私人主機 profile 的 SUCCESS／README；原 AC-01～03 | desired／inventory／setup 分工；固定來源同上，不列私人主機或設定 |

P-CF 相較規劃基準已新增離線事件摘要及明確選檔、同機 loopback 的單次傳送器；P-HOST 本次引用的兩份文件無變動。上述更新不是 Cloud Lab 新部署證據。私人來源不供公開讀者自行重跑；其結論限本次 lead 對帳，不能據此提升外部 qualification。

## 能力對照與不重做的理由

| 能力與原 AC | 固定來源所證明的範圍 | 現況未知／提案 | 本輪處置與理由 |
| --- | --- | --- | --- |
| IR-01～04：producer → JSON → D1 → 看板（C1） | 本機 consumer、嚴格有界報告、D1 最新快照與看板已有實作和驗證；該輪原 CLI GET 六區段403／unknown，沒有可讀真帳號快照 | IR 的「未部署」只描述 IR 時點，不能覆蓋後來 ML | 保留現有介面與流程，不再開「第二能力」重建 inventory |
| MC-01～03：固定 GET capture／原 producer replay（C1、P-CF） | MCP 可讀四區段，沿用原分頁／desired 比對與原收集時間，真報告有隔離 consumer 保存／讀回證據 | MC 只準備上線；Pages／Tunnels403仍 unknown，capture 不是 provider 簽章 | 保留原 producer；不另建 collector、不換身分或刷新時間冒充新資料 |
| ML-01～04：原 Worker／D1／資產上線（C2） | 2026-11-02T14:16:59Z 回讀完成；新增快照表並匯入一份重新收集的報告；首報 observed_at 14:13:12Z、received_at 14:14:21Z | 這是當時管理面保存／回讀；本輪未查現在 Worker、資料、真人登入或最新報告 | 已交付的盤點看板保留；不把歷史 snapshot 當今天資源現況，不安排自動更新 |
| CA-01～03：多VPS（C3） | 來源比較、工具用途對照與最小接入設計已交付；原單節點 runner 當時 active/running | 多節點 telemetry API／schema／collector 模式、獨立 scopes、兩節點看板與安裝均未實作；2026-11-02 程序存活不能推到今天 | 維持提案；具名 host/profile/owner 確認後才採用下一切片，不要求先建新總平台 |
| P-CF 事件摘要／sender | 原報告可轉成六段 aggregate CloudEvent；已保存事件可明確送往同機 Hub，歷史合成協定驗證不等於真來源接入 | 沒有因此證明真來源已註冊／接入、Cloud Lab 已訂閱或 inventory 會自動更新 | 保留為另一個 consumer 邊界，不把 sender 接入當 P04 工作，不重做 producer／desired writer |

ML 首報有四個可讀區段；**Pages／Tunnels 的403仍是 unknown，不能當作零資源、健康或已刪除**。原 desired 未修改，期望項未觀測到也不是刪除證據。公開本文不列資源名稱、帳號、網域或私人入口；當前 provider 可見範圍與帳單沒有新查核。（C2、P-CF 原 AC-01／02）

## Edge Ops 哪些部分不能被盤點取代

Edge Ops 保持 reference，不搬遷或退役。Cloudflare 資源 inventory／單一 node-health recipe 都不能替代下面的責任；「不能替代」不表示 Edge Ops 已把它們實作完成。（E1、C3）

| Edge Ops 責任／原 AC | 已有與缺口 | 與 Cloud Lab 的選擇 |
| --- | --- | --- |
| strict JSON、跨語言簽章及向量；AC-01 | M0 歷史契約證據 | 保留為參考；不能用相似 HMAC 名稱推論相容或直接抽共用核心 |
| freshness／歷史、離線與有限補報；AC-02 | S0 loopback mock 有歷史本機鏈路 | CA 首版只存每節點最新樣本，不承諾完整時序或補報；不能宣稱等價接替 |
| 真 collector、安全註冊、nonce／撤銷／generation；AC-03 | pending；mock 身分未替換、真 collector/enrollment 未接線 | 參考 collector／courier／execd 分權及 null 語義，不部署 mock，不繼承未通過的資格 |
| typed job、批准、本地主機政策、D1 CAS、取消／停止證據；AC-04 | pending；遠端與獨立安全審查等證據未齊 | 唯讀 inventory／telemetry 不承接操作權；Cloud Lab adapter 不變成 Edge Ops job authority |

## 期限對帳：歷史政策與當前未知

以下精確截止來自 C2 的 2026-11-02 回讀；resident policy 亦見 C1。對帳時點已是 2026-11-22 UTC。判斷的是**來源所載期限**，本輪沒有讀 live grant／revocation 或程序狀態，不能排除之後有人另行變更。

| 主體／政策 | 歷史截止（UTC）與權限 | 本次結論 |
| --- | --- | --- |
| runner grant | 2026-11-05T07:34:26Z | 原窗口已過；不推定今天有有效 grant，也不推定程序已停止 |
| scheduler grant | 2026-11-05T07:24:26Z | 原窗口已過；歷史 Cron 閉環不是今天仍可提交的證據 |
| schedule／resident policy | 2026-11-05T07:24:25Z | 原窗口已過；本頁不續期，不宣稱取消或停止效果 |
| bot | C2 記錄當時已過期 | 本輪沒有新政策回讀，不把工具存在當成可呼叫 |
| human revision3 | 2026-12-02T12:00:00Z；commands:read、artifact:read、inventory:read、inventory:publish | 相對本次日期，歷史截止尚未到；有效性仍受實際政策／撤銷／身分限制，當前登入與 live 使用未知。沒有 node-submit／取消權 |
| Access session | 歷史每次1小時 | 不因 human 政策跨日有效就產生長期登入 session；沒有本次真人登入驗證 |

## 唯一 writer 與下一步 gate

| 對象 | 原權威／允許的消費 | 本頁不取得的權限 |
| --- | --- | --- |
| CF desired／用途 catalog | P-CF 的 PR writer；producer 只讀 provider，Cloud Lab 保存被明確上傳的觀測 | 看板／唯讀 consumer 不反寫 desired、不根據缺漏刪資源，也不取得 provider mutation |
| host profile／主機設定 | P-HOST 的 profile writer／setup；inventory 產生實際觀測；一般 host 與 workload 各沿用既有 authority | telemetry 不取得 setup／sudo／Docker socket／workload lifecycle；profile 登記不等於可安裝或全VPS已受管 |
| commands／外部執行 | Cloud Lab 准入及證據索引；原 executor 擁有原生 job／run／stop／cleanup；工作驗收仍由原系統／owner 決定 | 看板成功、模型文字或事件 receipt 都不等於外部 Done／停止證明 |
| CA 多機資料（未實作） | 擬每台獨立 principal／node／generation；各自 telemetry:publish，人類明確 allowlist 的 telemetry:read | 原 inventory:read／commands:read 不自動變成 fleet scope；不能複製單槽 runner 身分到多機 |

這些分工沿用 C1 原 AC-03／04、[M0 契約][contracts]、[遷移 gate][migration]、C3 與 P-HOST；本次不改它們。若後續採用 CA，先固定一個具名 host/profile/owner、允許的 metric、身分／期限及安裝回退；以原 CA-03 的兩節點隔離、撤權競爭、重送／時鐘／過期及 workerd/D1 成本量測作驗證入口。這不是 P04 已啟動的實作，也不把方案批准當作安裝或新 grant 批准。

**本輪決策**：保留 inventory、Edge Ops reference 及各既有 writer；只新增跨里程碑比較與期限結論。來源已有完整技術細節，無需再寫第二份 collector／telemetry 規格；新增本頁的必要性是把 IR→MC→ML 的時序、已過截止與新事件 consumer 放在同一個可追溯對照中。

回退只撤回本頁及新增導航／本輪對照結論；原入口、資料、身分、規格與 runtime 原位保留。不把文件回退稱為外部副作用回退。驗證、審查及 Git 交付見[本輪證據](evidence/portfolio-p04.md)與[任務](tasks/portfolio-p04.md)。

[c1]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/SUCCESS.md
[c2]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/README.md
[ml]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/docs/evidence/inventory-live.md
[ca]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/docs/host-agent-design.md
[es]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/edge-ops/SUCCESS.md
[er]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/edge-ops/README.md
[contracts]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/contracts/README.md
[migration]: https://github.com/fallrising/newclear/blob/1f855489328736a2578bb0c9e7d76e688b4f5bf8/platform/cloud-lab/docs/migration.md
