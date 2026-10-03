# Tool Broker — 沙箱外工具授權與憑證邊界

- Revision：TB-design-0.1，2026-10-03。
- Status：**Proposed / documentation only**。尚未實作工具 broker、變更 egress、配置服務憑證或執行相關實機驗收。
- 設計基準：`newclear@4a75ad41508ab37800a4ab2ac2d16013de8cc2a0`；上游參考見 §12。
- 目的：讓 agent 在限定任務／資源範圍內使用外部服務，而不取得該服務的真正憑證。
- 權威：既有 [SDD](../SDD.md) 仍是產品基準。本提案使用獨立 TB 階段，不改寫 M0–M4、AT-07／AT-11／AT-12 或 AC 的完成狀態。文件合併只保存設計；各實作階段與 live access 須另行授權。

## 1. 決策與第一個使用情境

建議保留 Cocoon MicroVM、現有模型通道與固定節點 egress，新增**明確操作型的工具服務代理**。第一個 adapter 只提供指定 GitHub repository 的唯讀操作；一般 CLI 的透明 HTTPS 憑證替換留待後續評估。

例如 operator 允許某次 run 讀取一個 repository 的 metadata、指定 issue 與固定 commit 上的檔案。Agent 提交操作及參數，由可信端驗證任務身分、授權與服務憑證適用範圍，再組裝並送出 HTTP request。Agent 不能指定目的地 URL、憑證 reference 或任意 HTTP headers。

**GitHub write 邊界不變：** SDD §11.2 規定可寫憑證只給獨立 export worker；agent 不可自行 push 或建立 PR。本 broker 第一階段沒有 create-PR／push／merge 工具。日後只可由 operator 的獨立 export 流程授權固定 artifact／target；不能把「agent 要求建立 PR」當作 export 授權，也不能用通用 broker 繞過 AT-12。

## 2. 現有能力、缺口與參考的界線

以下為基準 revision 的文件／程式碼盤點，並非本次重跑測試。

| 項目 | 現有能力與證據入口 | 本提案新增的責任 |
| --- | --- | --- |
| Guest 隔離 | [控制服務 UID 2001／terminal UID 2000](M3-GUEST-ISOLATION.md)，root-owned helper 與 admission attestation | 新工具入口也必須維持隔離；不能把 session key 或模型 run token 給 terminal |
| 模型授權 | [Guest mailbox](M3-GUEST-MODEL.md)、[ModelProxy](../src/agent_platform/model_proxy.py) 核對 run／generation／lease 並持久化 request reservation | 借用授權原則；工具請求採獨立 schema、audience、狀態與 ledger，不直接放寬模型 dialect |
| 真正憑證 | [控制端 HTTPS transport](M3-HTTPS-PROVIDER.md) 與 [model_upstream.py](../src/agent_platform/model_upstream.py) 在 worker 加上 Bearer credential | 將 service instance、resource grant 與 credential binding 分開管理 |
| 一般 egress | [node-egress-v1](M3-EGRESS.md)：none lane、host proxy、sealed node policy、DNS/IP guard | 現行政策是節點級；CONNECT 不辨識內部 method／path。不能當作逐 run 工具授權 |
| 政策變更 | 現有 node policy 修改須 drain；不支援 active tunnel 即時撤銷 | 新 broker 可在每個操作 admission 核對撤權，但不宣稱因此撤銷現有 egress tunnel |
| GitHub | 目前 repository 透過固定 bundle 供應；write 屬 [SDD](../SDD.md) 的 M4 export 設計 | 唯讀 API 與 private repository access 都是新能力，仍需實作與 opt-in 驗收 |

OpenShell 的參考價值是：可信執行元件位於 workload 邊界外，網路授權與憑證目的地綁定分開驗證。它的透明 proxy 能在支援的 HTTP 位置替換占位符；本提案先採服務 adapter 主動構造請求，不宣稱已有相同協定覆蓋或形式驗證能力。

## 3. 範圍與不做的事

本設計針對既有 single-operator、single-node、OpenHands coding run。第一版仍只用受控 mock；之後才以明確 opt-in 的測試 repository 驗收唯讀 live API。

不在本提案內：替換 Cocoon／OpenHands、整套部署 OpenShell、任意 URL fetch、通用 HTTP proxy、TLS interception、SSH／Git transport／資料庫代理、GraphQL、MCP 動態工具探索、瀏覽器 cookie／登入、任意 shell 權限判讀、多租戶保證或付費 API。沒有新增 runtime dependency 的決定。

[Agent Computer](AGENT-COMPUTER.md) 的外部 client、GUI 與 cookie 權限是另一個邊界。Broker 的憑證不會因此進入 Chromium；已登入瀏覽器的 session 也不會自動受到本 broker 控制。AC 接入需另外建立身分與操作契約。

## 4. 架構與可信身分

```text
MicroVM                                      Trusted host
Agent / terminal (UID 2000)
  │ narrow local tool request
  ▼
Tool ingress + private mailbox (UID 2001) ← authenticated connector relay
                                                   ↑ poll / deliver
                                              Tool broker
                                                ├─ run admission + operation ledger
                                                ├─ immutable service/resource grants
                                                └─ adapter + credential resolver → GitHub API
```

圖中的 Tool ingress、tool mailbox、broker 與 adapter 都是**待實作元件**。目前 `guest_model.py` 只處理模型；不能直接加一個通用轉送參數或共用其 local/session key 來冒充工具整合。

### 4.1 Guest 入口與來源證據

- 提案採 guest Unix-domain socket 作為 terminal 可用的窄工具入口，由 UID 2001 helper 擁有；使用目錄／socket 權限與 `SO_PEERCRED` 核對 UID 2000。這只辨識工具帳號，不把可自稱的 binary path 當授權證據，也不區分同 UID 下的「善意」與「惡意」程式。
- UID 2000 可以提出 scope 內的操作，但不能讀取 UID 2001 私密 mailbox、控制憑證、broker credential 或更改 policy。入口不可接受 shell command、檔案路徑執行、目的地 URL 或控制 API 呼叫。
- Host 仍透過已驗證的 connector／sandbox relay 主動取件，guest 沒有到控制面的新直連路徑。新增 ingress 必須驗證 parser 限制與 helper hash／owner／mode；IPC 本身不是「天然安全」。
- Run 身分來自 host 保存的 allocation／binding、generation、live worker lease 及 connector 核對，不信任 guest JSON 自報的 `run_id`、owner、service credential 或 approval。請求帶有這些保留欄位時拒絕；host 在 envelope 補入可信值。
- 若 transport 需要 bearer capability，必須是新 audience `tool-broker`、短效、綁定 run／binding／generation 的憑證，只由控制 helper／connector 持有；不得接受 `mp1_` model token、session key、operator cookie 或其他 run 的 capability。具體 wire schema 和 token 發放流程是 TB-1 設計 gate。
- helper 重啟、VM restore、未知來源、binding 不符或失去 attestation 都 fail closed。未完成重新核對前不能以同一 run ID 自動恢復權限。

### 4.2 可信端責任

控制端 broker 分開處理三件事：run 是否仍可操作、操作是否在 grant 內、該服務憑證是否允許送到 adapter 選定的端點。Credential resolver 只向固定 adapter 提供秘密；回傳給 guest 的內容沒有 secret reference 或真正 credential。

第一版可沿用既有 worker 的 orchestration，但工具 upstream I/O／排隊須有獨立且有上限的執行資源，不能阻塞取消控制執行緒；網路 I/O 不持有 job/run DB lock。服務程序究竟獨立部署或在 worker 內分離，須在 TB-1 以故障／取消驗收決定，不能因模組拆檔就宣稱 process isolation。

## 5. 授權資料與雙重檢查

以下是**邏輯資料模型**，不是已存在的 table／API。

| 實體 | 核心欄位與約束 |
| --- | --- |
| Service instance | 管理員建立的 opaque ID、adapter revision、固定 HTTPS origin／API revision、credential reference、credential revision。任務不能修改 |
| Credential binding | service instance、允許的 scheme／host／port／path template、所需最小 upstream permissions；獨立於 run grant，由管理員設定 |
| Run tool grant | run／binding／generation、service instance、immutable policy revision、允許 operation IDs、canonical resources、request／byte／time cap、expiry。由 operator/profile 配置；guest 不可自建 |
| Operation | operation ID、可信 run identity、normalized argument hash、policy／adapter／credential revision、狀態與有限結果 metadata；不保存 credential |
| Approval grant | actor、operation ID、run／generation／binding、完整 normalized action digest、policy revision、expiry、一次性消耗狀態。第一個唯讀 adapter 不提供權限擴張申請 |

要 dispatch 必須同時成立：

1. **生命週期**：run running、generation／binding／owner 一致、lease／deadline 有效，沒有 pause／cancel／cutoff 或待人工審批狀態。
2. **操作授權**：operation、repository／resource、參數與上限符合該 run 的 immutable grant。未配置即 deny；model 或 repository 內容不能改 grant。
3. **網路目的地**：adapter 得出的 endpoint 通過 broker 自己的 egress policy、TLS 驗證與解析後 IP 檢查；沒有任意 URL fallback。
4. **憑證綁定**：credential resolver 確認 endpoint 與 service instance 的 binding 匹配；網路可達不代表可取得該憑證。
5. **必要審批**：如後續另行授權的 adapter 需要 approval，必須匹配本次完整 action，並與 operation reservation 原子消耗。

Policy／adapter／resource grant 在 run 內不可擴張。Credential 輪替、detach 或政策撤銷先關閉新 admission，撤銷舊 capability；第一版不嘗試無聲替換 active run 的 service revision。重新配置後由新 run 取得新授權。這不修改 sealed node policy，也不承諾撤回已送出的 request。

## 6. GitHub 唯讀 adapter 與傳輸契約

### 6.1 封閉操作集合

| 擬議 operation | 輸入 | 由可信 adapter 構造的 API | 限制 |
| --- | --- | --- | --- |
| `github.repository.get` | 配置中的 repository resource ID | 固定 repository metadata GET | 核對回覆 repository numeric ID |
| `github.issue.get` | repository resource ID、正整數 issue number | 固定 repo 下的 issue GET | 不跟回覆中的 URL；回傳欄位白名單 |
| `github.file.get` | repository resource ID、grant 固定的完整 commit SHA、相對檔案 path | 固定 repo 的 commit → tree → blob GET，所有 SHA 由可信回覆導出 | 核對 tree mode 後僅讀 regular blob；不跟 download URL，不讀 symlink／submodule |

Resource catalog 由 operator 固定 numeric repository ID 與 canonical owner/name。每個 operation（含 issue／file）都必須自行核對 metadata 的 numeric ID，不能依賴先前執行過 `repository.get`、名稱相同或長期快取；owner/name 被另一個 numeric ID 重用時拒絕。Credential 必須上游限定該單一 repository；多 hop 的資源身分與回覆關聯檢查列入 TB-1 contract，無法證明一致性即停止，不宣稱多筆 API 是原子 snapshot。名稱／擁有者漂移或移轉需重新核對，不能接受 301 後帶著 token 跟過去。檔案路徑以 segment 驗證及編碼，拒絕絕對路徑、空 segment、`.`／`..`、反斜線、控制字元與模糊的多重編碼；另受 grant 的路徑範圍限制。不得把 path 字串直接拼成任意 URL。

GitHub Contents API 可能直接回傳 symlink 目標的內容，因此不能只靠 Contents 的 `type: file` 證明 regular file。`github.file.get` 從固定 commit 取得 tree，逐 segment 核對 tree entry，最後只接受 mode `100644`／`100755` 的 blob；拒絕 `120000` symlink、`160000` submodule、truncated tree 或 SHA／path 不一致。Blob 必須由已核對的 tree 得出，不能接受 caller 自選 blob SHA；回傳只投影已授權檔案，不洩露旁邊 tree entries。參考 [GitHub Contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)、[Trees](https://docs.github.com/en/rest/git/trees#get-a-tree) 與 [Blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob)。

以上是自有工具名稱與範圍；不是現有 MCP 工具或已實作 API。TB-1 必須以固定 GitHub API revision 與 response fixtures 鎖定實際路徑、欄位與錯誤映射。

### 6.2 出站與回覆

- Production adapter 只連管理員核准的 `https://api.github.com:443` 與固定 API 路徑；GHES 或其他服務是新 adapter/profile，不能用任務參數切換 base URL。
- Broker 到外部 API 是一條**新的可信端出站路徑**，不受 guest node allowlist 自動保護；須獨立設定 deny-by-default allowlist、DNS-to-public-IP guard、TLS hostname／chain verification、Host/SNI／選定目的地一致性。解析結果須綁定實際 socket dial，不在檢查後再按原 hostname 重新解析；不允許私網／metadata fallback。
- 不讀 ambient proxy、不跟 redirect、不自動 retry、不接收 agent 提供的 cookies／Authorization／額外 headers。Credential 由 adapter 在驗證後加入；Upstream credential 必須短效、限定該 repository 且只有必要讀取權限；write-capable 或跨 repository 的 token 不可接入本 broker。憑證型別與權限證據是 TB-3 啟用 gate，不能僅因工具是 GET 就假定 token 唯讀。
- Mock 使用獨立測試 transport／credential，production policy 不接受 loopback 例外。測試旗標不可來自 task；mock 通過不能代表 live GitHub 相容性。
- 設計預設：request JSON ≤32 KiB、upstream response ≤1 MiB、解碼後 file ≤256 KiB、每 run 最多 2 個 in-flight、每 operation 10 秒總期限／5 秒 idle timeout、最多 100 個 admitted operations。每 operation 至多 8 筆固定 adapter HTTP calls（含 repo identity／commit／tree／blob），路徑最多 4 個 segments；1 MiB 是所有 upstream 回覆的累計上限，10 秒也涵蓋全部 hops。Operation cap 與實際 HTTP call count 分開記錄，不能把多 hop 說成只有一筆上游請求。Operator 可收緊，guest 不可提高；實作前由 TB-1 固定版本。不得以每個 chunk 重設總期限。
- 第一版不支援串流、自動分頁、壓縮回覆、任意 download URL。嚴格檢查 Content-Type、大小、schema 與 resource identity；未知欄位不直接投影到 agent。API 回傳錯誤只映射固定 code，不把原始 headers／error body／exception 寫入事件。
- Repository 檔案、issue 文字仍是非可信資料。輸出經既有安全呈現與大小限制；已知完整 token 命中時拒絕，不宣稱可防止任意編碼或上游蓄意回顯秘密。

## 7. 操作生命週期、審批與不確定結果

### 7.1 Admission 與持久化

1. Guest ingress 在私密 mailbox 保存 operation ID 與 normalized payload 後等待 host 取件。ID 由受控 helper 配置；host 以 `(run_id, operation_id)` 去重，不能以新 ID 自動補送失敗請求。
2. Broker 驗證 schema、固定 adapter／grant，按既有 job → run 順序取得鎖，使用鎖後 DB clock 核對 live state、期限、generation 與可用額度。
3. 如需審批，持久保存完整 action 與待審狀態，尚不 dispatch。Operator 可審查全部參數；修改參數、policy／generation／binding 後原批准失效。Approve endpoint 只供 operator，guest 無核准權。若 run 因審批而離開 running，必須經既有 operator／worker 控制流程恢復 running 並重新核對 lease／binding，才可 admission；批准本身不繞過生命週期 gate。
4. 在同一 transaction 完成授權、額度 reservation、必要 approval 的一次性消耗，寫入 `admitted` 後 commit。這是 admission 的線性化邊界。失敗或無法持久化時不呼叫上游。
5. 在 DB lock 外執行一次有界 adapter operation，記錄成功／拒絕／unknown。多 hop adapter 每一個 hop 都受同一 grant／deadline／累計上限及獨立憑證綁定檢查，送出前重新核對撤權；任何 hop 不確定即停止，不 retry 也不回傳部分結果。成功回覆交付前再次核對授權；撤權後保存操作結果 metadata，但不交付舊 completion。

同 ID／不同 payload 必須 conflict；同 ID／相同 payload 只回操作狀態，不重新 dispatch。Broker crash 或 delivery ACK 遺失不能把 operation 刪掉重建。第一版沒有通用結果重播；若未確認交付，顯示 `delivery_unknown` 並安全停止該工具通道，保留對帳入口。

### 7.2 狀態與競爭

| 事件 | 要求 |
| --- | --- |
| Admission 前拒絕 | `denied`，upstream dispatch count = 0，不消耗已核准的其他操作 |
| 等待批准時 cancel／expire | `cancelled`／`expired`，批准不可復活該操作 |
| Admission 已 commit，尚未確認發送／回覆 | 保守視為可能送出；crash 後 `unknown`，不假設零副作用、不自動退款或重試 |
| 429／timeout／斷線／不合法回覆 | 記固定原因與 `unknown`；每次 admitted operation 保留 request／資源占用紀錄，不自動退還 request cap |
| 已驗證成功、guest 收不到結果 | 保留 upstream 結果 metadata，delivery 狀態獨立；不以新 ID 自動重跑 |
| Pause／cancel／lease 遺失／recovery | 狀態提交後新 admission 拒絕；舊 generation 的 completion 不交付；恢復須顯式重綁新 generation 並重新核對 grant；ledger／cap 以原 run 保存，不能重設 cap／消耗過的批准 |
| Run 結束、撤銷 service 或 credential | 撤銷新 admission 與 capability；封存 operation metadata，不刪除 unknown 證據 |

**撤權不是外部回滾。** Admission 先於 pause/cancel 提交的 request 可能仍送出並完成，即使當時還未建立 socket。可以做 best-effort pre-dispatch recheck／abort，但不能宣稱消除競爭。未來 export 仍遵守自己的 effect reconciliation 契約。

Pause 也不能只把「broker 停止收件」當成 VM quiescence：須結合既有 terminal／SDK 工具邊界、mailbox pending 狀態及 in-flight I/O 證據；不能確認時保持 pausing／unknown，由既有取消／期限流程收尾。Broker 不自行釋放 VM reservation，不削弱完整 stop proof。

## 8. 稽核、秘密與威脅模型

Audit 只保存 operation ID、可信 run identity、operation kind、policy／adapter／credential revision ID、參數 digest、決策、狀態、時間及 bounded byte counts。私有 repository 名稱、檔案內容、issue 文字、完整 URL／query、raw request/response 與 token 不進一般 log／SSE／公開 evidence。操作結果屬 run-private data，需套用既有存取與 retention；report 不以原文輸出當除錯捷徑。

安全論證依賴可信 host、connector、broker、helper 及 guest kernel；這不是 host compromise 或 kernel exploit 防禦宣告。主要威脅與回應：

| 威脅 | 邊界 |
| --- | --- |
| Prompt injection 誘使 agent 用更大權限 | Prompt 不能修改 grant；每次操作在可信端核對。已授權範圍內的資料存取仍可能被濫用 |
| 跨 run 借用 token／approval | 可信 binding＋generation＋audience＋lease；同 service 不表示同 resource grant |
| SSRF、redirect、DNS rebinding | 無任意 URL；固定 adapter、實際 dial IP guard、無 redirect、TLS 驗證 |
| 以允許域名外洩 credential | 網路授權和 credential binding 獨立；不轉送 guest headers，不向 guest 回傳秘密 |
| 批准後偷換參數／recover 後重用 | Canonical digest、immutable revision、原子一次性消耗、generation fence |
| 不確定結果重送、配額重設 | Durable operation ledger／保守 unknown；rotation／restart 不清零 |
| 通過一般 CONNECT 繞過 broker | TB 實驗以 guest deny-all 及專用 broker 路徑驗收；若另外允許一般 egress，就不能宣稱所有外部操作均經 broker |

不提供通用資料防外洩保證：agent 取得允許讀取的內容後，仍可把資料放入其他已授權通道；甚至狹窄 API 的 path／參數也可能承載訊息。需要進一步資料流政策時另設範圍，不靠「key 沒進 VM」推論資料安全。

## 9. 分階段交付與啟用

| 階段 | 範圍 | 完成 gate |
| --- | --- | --- |
| TB-0（本文件） | 現況盤點、設計與驗收契約 | 文件審查、連結／範圍檢查、文件 PR；不宣稱功能可用 |
| TB-1 | 固定 tool schema／API revision、service/grant/operation 資料契約、mock broker、授權與 ledger | 下節 unit／DB／HTTP 案例；確定 credential store／進程位置／wire 協定，尚不接 guest 或 live GitHub |
| TB-2 | 專用 guest ingress/mailbox／connector relay、SDK 工具 adapter、pause/cancel/cutoff | 真實 deny-all KVM 驗證隔離、跨 run、故障與停止證據；mock API，沒有真實憑證 |
| TB-3 | 單一測試 repository 的 GitHub 唯讀 opt-in | 最小 upstream 權限、resource identity、credential 不進 guest、受控 live read；無寫入、PR 或 merge |
| 後續另議 | 更多服務、與 M4 export 的共用授權元件、透明 proxy／OpenShell integration | 先有獨立設計與授權，不由 TB-3 自動延伸 |

預設 disabled；舊 profile 與 active run 不取得新工具。啟用需新增 immutable profile revision 並從新 run 開始。新增 helper／transport 時沿用 drain、hash pin 與 attestation；不能原地修改 active guest。停用先撤權並對帳 in-flight／unknown，再走既有 run cleanup；不刪 journal、不降低 generation、不用 host shell fallback。

OpenShell 整合是否值得，留到需要透明 CLI、跨 provider 或通用網路 policy 時再比較。評估需包含現有 runtime 相容性、身份傳遞、撤權競爭、snapshot／恢復、維運與信任範圍；本文件未宣告其可直接替換任何元件。

## 10. 驗收矩陣（未執行）

所有 TB-AT 項目目前均為 **Planned / not run**。優先以 deterministic unit／DB／HTTP contract 暴露錯誤，KVM 只證明較窄測試無法建立的 guest 隔離與跨系統 wiring。

| ID | 層級 | 必須可觀測的結果 |
| --- | --- | --- |
| TB-AT-01 | Unit／HTTP | 未列 operation、repo、commit、path、保留身分欄位、額外 headers／URL 均拒絕，mock 收到 0 requests；另以固定 upstream fixtures 驗證 repo-ID 重用、symlink／submodule／truncated tree 拒絕，不交付內容 |
| TB-AT-02 | Unit／HTTP | Run A 權限／token／批准用於 run B、錯 audience、舊 generation／失效 lease 都拒絕，0 dispatch |
| TB-AT-03 | Unit／HTTP | 網路允許但 credential binding 不匹配時拒絕；service credential 不能跨 origin／port／path；mock upstream 不收到 run token |
| TB-AT-04 | HTTP／socket | Redirect、DNS public→private、metadata／IPv6 特殊位址、TLS hostname／CA 錯誤均拒絕；驗證 guard 使用的 IP 就是 dial IP |
| TB-AT-05 | DB／並行 | 同 ID 同 payload 至多一次 adapter operation，各 HTTP hop 不重送且不超過 cap；不同 payload conflict；並行上限不超發，DB failure 零 dispatch |
| TB-AT-06 | DB／故障注入 | Admission commit 前後、發送前後、settlement／delivery 前後 crash；恢復不重派，unknown／cap 保留，不捏造成功 |
| TB-AT-07 | DB／HTTP | Approve digest／revision／generation 不符、過期、並行雙重消耗均拒絕；唯讀 adapter 無 write operation；export 授權不能由工具 grant 代替 |
| TB-AT-08 | DB／整合 | Pause／cancel／cutoff／lease expiry 與 admission 競爭符合 §7；新 dispatch admission 被擋、舊 completion 撤權、pause 無假 quiescence |
| TB-AT-09 | HTTP／socket | 慢 header／body、超量回覆、壓縮／schema 錯誤、429、秘密回顯：bounded failure，log／SSE 無 secret 或原始 payload |
| TB-AT-10 | KVM | UID 2000 可呼叫窄工具入口，但不能讀控制 keys／mailbox、signal helper、改 policy／helper 或繞過 deny-all；雙 VM 不能混用 identity |
| TB-AT-11 | KVM／故障注入 | Helper restart、worker takeover、pause/resume、取消及完整停止；不重建原操作，stop proof 不完整不釋放 VM slot |
| TB-AT-12 | Opt-in live | 測試 repo 的 metadata／issue／固定 commit regular file read；每種 operation 各自檢查 repo identity，涵蓋 owner/name 被新 ID 重用；symlink／submodule／truncated tree 拒絕；憑證不進 guest；惡意／漂移場景先由 TB-AT-01 的 mock fixtures 覆蓋，live 僅使用 operator 預置資料、不由 broker 建立；未配置 live credential 時明列 not run |

驗收記錄需附 source revision、policy／adapter digest、命令、結果、dispatch 計數及故障時點；只保存可公開的 hash／摘要。Mock credentials 用 canary，不使用 operator 真 key。沒有主機或 live key 時不能拿 CI／Docker／mock 證據替代 KVM 或 live gate。

## 11. 實作前待定與停止條件

- TB-1 固定 schema、GitHub API revision、錯誤碼、DB migration／保留策略與 service credential 發放／撤銷操作。上述數字是設計預設，不是已測得 SLA。
- TB-2 必須證明新 SDK 工具呼叫路徑確實進入 broker，且不洩漏既有 model/session keys；無法達成就停止該整合，不放寬為任意 host fetch。
- TB-3 由 operator 另行指定測試 repository、最小 GitHub credential 與 live-read 授權；不得搜尋主機既有 token 自動接用。
- 不把本文件的合併、上游 README 宣告、模型能呼叫工具或 mock 成功，當成完整 AT-07／AT-11／AT-12、安全認證或 production-ready 證據。

## 12. 參考來源與採用範圍

2026-10-03 查閱。官方線上文件可能更新；OpenShell main 當次觀測 revision 為 `48d9ab3d0d9a343365dea1b0cd87565050ac658e`。只借鑑架構概念，未 vendor 程式碼、安裝套件或建立 runtime 相容性聲明。

- [OpenShell README（固定 revision）](https://github.com/NVIDIA/OpenShell/blob/48d9ab3d0d9a343365dea1b0cd87565050ac658e/README.md)：隔離、政策執行與 credential use 的整體方向。
- [Architecture](https://docs.nvidia.com/openshell/latest/about/architecture)：trusted supervisor 與 workload 邊界。
- [Providers](https://docs.nvidia.com/openshell/latest/how-it-works/providers/overview)：placeholder、network authorization 與 credential endpoint binding；opaque TCP／TLS tunnel 不支援 credential rewrite。
- [Network Rules](https://docs.nvidia.com/openshell/latest/how-it-works/policies/network-rules)：連線與 request inspection 分層；不能只看目的地主機就宣稱限制 API 操作。
- [Policy Advisor](https://docs.nvidia.com/openshell/latest/how-it-works/policies/advisor)：政策提案與人工／自動審核；本提案第一版不採用自動擴權或 prover。
