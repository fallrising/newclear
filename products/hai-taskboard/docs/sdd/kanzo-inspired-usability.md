# Mini-SDD：Kanzo 借鏡與 HAI 日常工作流程

Status: **Proposed follow-up design / implementation NotRun**，2026-10-29。
本次為 T-1029 文件工作；設計審查、實作授權、功能驗收分開記錄。
Parent: [P0-A SDD](../SDD.md)、[SUCCESS](../../SUCCESS.md)。
HAI 核對基準：`0111908492c32d0b01d561b24b6024737cb4f641`。
Kanzo 參考基準：`005424d4d0b4c2971278a14de6fbca6189605e6c`。

## 1. 目標與當前可用範圍

讓單一 operator 能很快收集工作、找回工作、看懂 agent 回報，並沿用 HAI 的
受控派工與證據驗收。本文件選定後續設計方向與可驗收切片；不把新增功能併入
既有 P0-A 的完成條件，也不授權真 agent、MCP listener、外部服務或部署。

| 層次 | 可用範圍／驗收門檻 | 核對時的狀態 |
| --- | --- | --- |
| 現有開發試用 | 本機 authenticated React、project/Draft、明確接受規格與 AC、Ready、Fake dispatch、原命令結果查回、SSE 重連 | 已有局部程式與歷史瀏覽器證據；Fake 成功後仍停 Developing |
| 完整 P0-A | SUCCESS AC-01..04 全部通過：完整 Candidate/Review/Evidence/QA/Done、detail/attention/impact、activation、backup/restore、ContextPack 接續 | 未完成；AC-02/03/04 pending；`usable_tag: none` |
| 日常真實 agent 工作台 | 完整 P0-A，加上另行授權並驗收的單一真實 adapter、agent 身分／權限、取件／回報／驗收與失敗接續流程 | 未啟用；Fake 或文件通過不能替代真實整合驗收 |

現況依 [README](../../README.md)、[SUCCESS](../../SUCCESS.md)、
[traceability](../traceability.md) 與 [current board](../tasks/BOARD.md)。
本次不重跑 runtime；上述歷史通過項目保留其原始日期與範圍。
沒有真實 provider 是 P0-A 的既定邊界；Fake-only P0-A 仍可獨立完成驗收。

## 2. 取捨與權威

| Kanzo 行為 | HAI 採用方向 | 限制／先決條件 |
| --- | --- | --- |
| 很短的啟動與進入看板流程 | 一份可重現的本機入口，明示 Fake 模式、資料位置及停止／重啟方式 | 沿用 Go/React；不承諾現有 zero-setup 發行版或改寫技術棧 |
| 快速新增與 Backlog | 標題先存為既有 Draft；以 Draft 收集視圖表達 Backlog | 不新增同義 phase，不自動接受規格、Ready 或派工 |
| 全域搜尋、鍵盤操作 | 按鈕與快捷鍵共用搜尋／開啟詳情；先支援 ID、標題、project、phase | 只讀授權範圍內的投影，不因搜尋取得變更權限 |
| 任務留言與圖片 | 簡短、可追溯的進度註記；先引用既有 artifact | 註記不滿足 Review/Evidence/Approval；拖放圖片上傳延後 |
| Human-only | operator 管理的派工政策，由服務端拒絕不允許的 agent 操作 | owner 欄位、UI 隱藏與 MCP prompt 都不等於權限 |
| 簡短 MCP 工具與回覆 | 摘要預設有界、詳情按需讀取；保留結構化命令結果及恢復資訊 | 不刪除 command/version/fence/error 等必要欄位來節省 token |
| repo 自動選 project | 從已核准的 repo binding 輔助選取 project | 不建立新權限、不接受規格、不當成 GitHub Issues/PR 同步 |
| Markdown/JSON export | 可攜、唯讀的專案快照與摘要 | 不是 backup/restore；不形成 Markdown/SQLite 雙向 authority |

下列不採用：任意 `update_task(status=...)`、agent 永久刪除任務／稽核紀錄、
以 prompt 代替 Done gate、無驗證的網路 MCP、任意 author 字串作為稽核身分、
將整份 SQLite 放進 Git 後讓多機分歧互選。Kanzo 的取件有 SQLite 原子性；
它的 Git sync 用於切換機器，沒有逐任務合併，不能直接承擔 HAI 的執行恢復語意。

所有後續介面沿用 [ADR-001](../adr/ADR-001-authority-and-persistence.md)、
[ADR-002](../adr/ADR-002-domain-and-completion.md)、
[ADR-003](../adr/ADR-003-execution-and-recovery.md)：

- SQLite 保存 operational state；Git 保存 immutable spec；Board/SSE/search/export 是投影。
- 變更走 application commands；授權、expected version、idempotency、audit/outbox 原子提交。
- WorkItem、Run、Candidate、Review、Evidence、Approval、CompletionRecord 維持分離。
- Run 成功、進度註記、Decision、MCP 回覆均不能直接產生 Done。
- lease 過期代表需要對帳；不推定 executor 已停止，也不自動重做結果不明的副作用。
- 維持 [Board-first UI](ui-interaction.md)；不把 Attention 或活動量改成首頁中心。
- 本文件不接受 [Decision/Attention/ledger](decision-attention-ledger.md) 中仍 Proposed 的條款，
  不沿用其歷史 migration 編號或當時的工作帳本現況。

## 3. 後續功能契約

以下 `HAI-KZ-*` 都是**待審查的後續條款，實作／驗證 NotRun**。
其中「必須」表示該切片被採納後的驗收要求，不表示已實作。

### HAI-KZ-001 — 可重現的本機入口

單一文件入口連到權威啟動配方，列明 pinned prerequisites、前端 build/serve、
loopback URL、私有資料根、session 設定、停止及沿用同資料根重啟的方法。
示例及模式提示明確寫 Fake；health 成功只表示相應 runtime 就緒，不表示整個產品可用。
不新增尚未實作的 CLI 安裝／service／update 指令，不輸出憑證，不放寬 Origin/Host/權限。

**驗收：** Given 乾淨本機環境，When 依文件啟動並完成已列明的 Fake 流程及重啟，
Then 結果可重現、資料保留、模式清楚；缺依賴／錯設定／port 衝突有可操作診斷。
本條只整理或補強入口；完整 P0-A 的驗收仍以 SUCCESS 為準。

### HAI-KZ-002 — Quick capture 與 Draft 收集區

已明確選定 project 時，可用標題快速建立 Draft。沿現有 CreateWorkItem command：
`Title` 使用輸入標題，`Goal` 暫以同一標題原文作 Draft goal，`OwnerID` 使用已驗證的
目前 operator 身分並由授權層核對；UI 清楚標示這是待整理的 goal，不能視為 accepted spec。
不填入任何 accepted AC：command 的 RequiredACRevisions 為空，HTTP request 明傳
`"required_ac_revisions": []`（現有 API 接受明確空陣列，省略欄位或傳 null 會被拒絕）。
這個映射不放寬既有輸入驗證。
Backlog 是 Draft 的收集視圖名稱，不新增持久 phase。儲存成功回傳 project/WorkItem ID；
失敗保留輸入；重送使用原 command/idempotency identity。快捷鍵在編輯欄位內不得誤觸，
並保留普通按鈕入口。沒有 accepted AC／有效規格時不得轉 Ready 或被 claim-next 選取。

**驗收：** Given 只有標題的新工作，When 儲存、重送、重新開啟，再嘗試派工，
Then 只有一筆可找回的 Draft、goal/owner 與上述映射一致且沒有 accepted AC，
未接受規格的派工被既有 guard 拒絕。

### HAI-KZ-003 — 有界搜尋與開啟詳情

先搜尋 ID／標題，並提供 project／phase 篩選；不假設 tags 或全文索引已存在。
預設每頁 20 筆、上限 100 筆，有穩定排序及 continuation；結果包含 project、ID、標題、
phase 與 projection freshness。按鈕與 Cmd/Ctrl-K 開啟同一入口，選取後到 canonical detail。
搜尋只讀 caller 可存取的 project；過期游標明確要求重查，不靜默漏頁或重複改狀態。

**驗收：** Given 多 project、超過一頁且含同名任務，When 搜尋／分頁／鍵盤開啟，
Then 可區分正確工作、結果不越權、焦點可恢復，DB 無任何狀態變更；輸入框快捷鍵不搶字。

### HAI-KZ-004 — 進度註記與成果引用

在人或 agent 被授權的 WorkItem 下追加短註記；principal、時間、project/WorkItem 與可選
Run reference 由服務端核對，不能信任 caller 自填 author。註記有獨立身分；更正另追加並
連回舊紀錄。它與狀態事件／正式審查可互相連結，但不改 accepted spec 或滿足 Done 條件。
需要決策／授權／驗收時，仍送到各自的正式流程；不以一則「同意」留言代替命令。
第一個切片僅引用已授權且 digest/可用性可驗證的 artifact，不新增任意檔案上傳或宿主路徑曝光。

**驗收：** Given 一筆工作與重送的進度更新，When 追加、重送、跨 project 引用 artifact，
Then 合法註記只產生一次且可追溯、越權引用被拒絕；「已完成」文字不改 phase 或 evidence。

### HAI-KZ-005 — Human-only 的服務端派工限制

後續 operator 管理的 execution policy 區分 human-only 與允許 agent 的工作。
Human-only 不等於 human owner，也不等於 Done approval。agent 讀取／寫註記由各自權限判定；
agent 不得自行解除 human-only，再透過任何 API/MCP 路徑認領或派送 executor Run。
啟用前的 ADR 必須決定儲存／migration、既有工作預設值與 active/unknown Run 的處理；
缺少明確 agent eligibility 時先拒絕外部 agent 認領。政策更新不能取消既有 Run 的事實、
改寫歷史或推定副作用已停止；有 active/unknown Run 時拒絕不相容變更並要求對帳。

**驗收：** Given human-only 工作，When agent 直接呼叫 claim/dispatch 或修改政策，
Then 服務端拒絕並留下必要 audit；operator 的合法政策變更仍受版本與現有 Run guard 約束。
此切片的 policy/migration ADR 尚未接受，不能直接依本段改 schema。

### HAI-KZ-006 — 精簡但完整的機器回覆

list 只預設回傳識別、phase、必要 eligibility/guard 與 freshness；長描述、註記、
完整事件與 artifact 透過有界 detail 查詢取得。文字摘要可以短，機器結果保留 command ID、
aggregate version、Run/subject/evidence references、有效 claim/fence 與到期資訊。
拒絕保留穩定 error code、unmet guards 和下一個允許動作。敏感 claim capability
只在其受驗證通道回傳，不混入一般列表、匯出或日誌。不得把 token budget 當作刪欄位理由。

**驗收：** Given 成功、衝突、過期 claim 與結果不明的 fixtures，When 用精簡回覆續作，
Then client 能以結構化欄位取回原結果／正確停止，不須猜測自然語言；量測 schema 與典型回覆大小。
先記錄測量，再決定預算，不承襲 Kanzo 的 token／效能數字作 HAI 已達成宣稱。

### HAI-KZ-007 — 唯讀匯出

JSON 匯出有 format version、generated_at、snapshot/high-water identity 與來源版本；
同一快照順序穩定。Markdown 是閱讀摘要，兩者均明示 Fake／真實來源及 evidence references。
僅匯出 caller 可讀的 project 與允許欄位；不含 token、claim capabilities、provider credentials、
私有宿主路徑或未授權 artifact bytes。匯出與狀態同時變動時，使用一致快照或明確要求重試。
它不改 DB、不 commit/push、不匯入回寫，也不取代 SQLite/artifact manifest 的 backup/restore。

**驗收：** Given 固定快照與並行更新，When 匯出 JSON/Markdown，Then 邊界／版本清楚、
沒有混合版本或副作用、敏感資料被排除；另一人能理解目前工作，但不能將摘要當作還原備份。

### HAI-KZ-008 — 已授權 repo 的 project resolution

只有預先核准的 repository binding 參與解析。規格化僅使用明列且測過的 identity 規則，
例如同一 GitHub owner/repo 的 SSH／HTTPS URL；不只比對 repo basename。
恰好一個可讀候選才可選定；無候選／多候選需明確 project，不自動建立或重綁。
本機 stdio 使用受限 cwd context；HTTP 必須明傳 project 或已驗證 binding ID，
不能假裝知道遠端 cwd。不得 shell-interpolate 任意 URL，也不任意存取未核准 repo。
解析不變更 accepted spec、commit/digest、dispatch authority 或任何權限。

**驗收：** Given SSH/HTTPS aliases、同名不同 owner、多候選與撤銷 binding，When 解析，
Then 僅唯一合法候選被選定，其餘明確拒絕／要求選擇；解析無寫入副作用。

### HAI-KZ-009 — MCP pull 工作流程

MCP 是後續的薄 transport adapter；P0-A 的 MCP non-goal 保留。
以下是預定邏輯操作，**不是已存在的工具名稱、API 或可執行命令**：

| 操作 | 使用目的 | 必須沿用的權威邊界 |
| --- | --- | --- |
| ListProjects / ListWorkItems / GetWorkItem | 找 project、摘要與有界詳情 | principal/project scope、read-only projections |
| ClaimNextWorkItem | 取下一件可執行工作 | accepted inputs、Ready、無 blocker/pending/active/unknown Run、execution policy、原子 claim |
| AddProgressNote | 回報進度或指出阻塞 | HAI-KZ-004；正式 blocker／Question 另走相應命令 |
| AcknowledgeStart / PublishObservation | 回報已開始、執行觀察與終止結果 | 經審查的 executor contract、目前 Run fence 與驗證過的 actor |
| Heartbeat / RenewLease | 回報存活並依政策續租 | 目前 holder/epoch/input/restore generation、尚有效的 lease、政策限定的到期時間 |
| SubmitCandidate / SubmitEvidence | 提交成果及驗證資料 | subject-bound provenance／verifier policy；不得自行完成工作 |
| GetCommandResult | 回應遺失後恢復 | 原 command identity 與查詢權限；不重新領取另一件工作 |

External pull 不是現有 Fake poller 的別名。實作前須先接受 application command／executor
ADR：選取、建立 immutable Run input/outbox 與取得持有權須在同一 transaction 完成，
且同一 dispatch intent 不能同時被 internal push worker 與 external pull client 執行。
取得 claim 不等於已開始；只有有效 start acknowledgement 才改 observed execution state。
Claim 本身也不是 HAI-STATE-002 的 operator start。沒有既有明確 operator start 時，
WorkItem 保持 Ready 並顯示 pending Run，直到 current-subject start ACK 才進 Developing；
pending Run 仍排除重複認領。不得借 operator credential 呼叫現有 DispatchRun 來略過此邊界。
這項 WorkItem phase/Run claim 連動必須在 external-pull ADR 中定案並驗證。
同 request 重送回同一 command result/Run；不得生成第二次執行。
Heartbeat 觀察與 lease 續期是不同效果；記下一次 heartbeat 不能自動推定已續租。
續租須在 transaction 中核對目前 holder/epoch/input/restore generation 與未過期 deadline，
只能按已接受政策延長有界租期；stale／expired principal 不得靠晚到心跳復活持有權。
過期或舊 epoch 的 publication 必須被拒絕；失聯後進 NeedsReconcile/OutcomeUnknown，
不自動回收成可重做的 Ready。CancelRequested 也不等於 confirmed stop。

先定獨立 agent principal、project/action permission 與可撤銷 capability；
不重用 operator session/human credentials，不以 agent 自報名稱識別。
stdio/HTTP 都走同一 command path；HTTP 必須有驗證、scope 與明確部署邊界，
不得為方便直接提供無驗證網路 listener。transport 新增不自動開放 host/network 權限。

**驗收：** Given 兩個 client 爭同一件 Ready 工作，When 同時 claim、丟回應再重送、
失聯及晚到回報，Then 至多一個有效 Run/claim、可查回原結果、舊持有者被拒絕且未知副作用不重做。
另驗有效續租、過期／舊 epoch 心跳拒絕、human-only/未接受 AC/blocked/越權排除、
push/pull 互斥與 operator-only completion。
禁止提供 unrestricted status update、永久 delete 或可繞過 Done 的 generic tool。

### HAI-KZ-010 — 一個真實 agent 的日常閉環

先選一個真實 coding client/adapter、一個 project、一個有界任務，完成
operator 收集/接受規格 → agent 取件/回報 → 提交 Candidate → 獨立 Review/Evidence →
operator 驗收的流程。選用 client、provider/credential/host/network 範圍與成本上限，
由後續 G2 授權明定；本文件不新增任何外部接入授權。

**驗收：** Given 已通過完整 P0-A 且獲 G2 授權的有界環境，When 執行上述真實閉環及
中斷/回應遺失案例，Then 有來源 SHA、實際成果、獨立證據、正確完成或明確阻塞／對帳結果。
Fake contract tests 與真人 agent 整合證據分開；不得以接通 MCP、CLI exit 0 或 agent 自述宣稱可日用。

## 4. 實作順序與接手方式

此表是**未認領的實作切片規劃**，不是第二份執行狀態板。
真正開工時依 owner 授權在 [BOARD](../tasks/BOARD.md) 建立一個有界 `T-####`，
指定範圍、AC、獨立 reviewer 與當時基準；先接受條款及具名測試骨架再寫 production behavior。
目前只執行 T-1029 文件工作，不啟動下表功能。

| 順序／切片 | 交付範圍 | 依賴與停止點 |
| --- | --- | --- |
| 現有 P0-A 主線 | 完成 SUCCESS AC-02/03/04、完整 Fake 人類驗收及恢復 | 沿既有 H02/H03/H04；新增便利功能不阻擋、不取代原驗收 |
| U1-ENTRY | HAI-KZ-001 本機入口與模式提示 | 文件澄清可先做；任何啟動／UI behavior 補強須另行認領，完整實測後才稱可重現 |
| U1-CAPTURE-SEARCH | HAI-KZ-002/003 的 Draft 收集與搜尋 | P0-A 完整驗收後；先接既有 commands/projections，不擴 phase |
| U1-NOTES-EXPORT | HAI-KZ-004/007 | 現有 artifact/auth 邊界；先 notes/reference 與唯讀 export，圖片上傳延後 |
| U2-POLICY-CONTEXT | HAI-KZ-005/006/008 | 接受 policy/migration/auth ADR，保留舊紀錄並測相容性；未定案即停 |
| U2-MCP-CONTRACT | HAI-KZ-009 的 transport 與 Fake contract 驗證 | P0-A 及 U2-POLICY-CONTEXT 完成；另行授權 MCP 範圍、接受 external-pull ADR；仍不啟真 provider |
| U2-LIVE | HAI-KZ-010 | G2 明確授權，且 MCP/adapter contract 與其必要安全/恢復驗證通過 |

不在此輪承諾多 provider、多人 RBAC、Slack/Lark、跨機離線合併、auto-update/service installer、
拖放圖片上傳或 GitHub Issues/PR 雙向同步；有實際使用需求時再獨立界定範圍。

## 5. 追溯與預定驗收

所有下列名稱是**未新增、未執行的測試計畫**；不作現有 test coverage 或 passing 證據。
測試值使用公開合成 project/repo/actor，不保存私人憑證或宿主資訊。

| Clause | 後續具名 oracle | 狀態 |
| --- | --- | --- |
| HAI-KZ-001 | `local-entry-fake-restart.spec.ts`；缺依賴/設定/port 診斷 | Proposed / NotRun |
| HAI-KZ-002 | `quick-capture-draft-replay.spec.ts`；`TestClaimNextRejectsUnacceptedDraft` | Proposed / NotRun |
| HAI-KZ-003 | `work-search-scope-pagination-keyboard.spec.ts` | Proposed / NotRun |
| HAI-KZ-004 | `TestProgressNoteIdentityReplayAndArtifactScope`；`TestProgressNoteCannotSatisfyDone` | Proposed / NotRun |
| HAI-KZ-005 | `TestHumanOnlyRejectsAgentDispatchAndPolicyMutation`；`TestExecutionPolicyMigrationPreservesActiveRuns` | Proposed / NotRun |
| HAI-KZ-006 | `TestCompactResultPreservesRecoveryAndGuardFields` | Proposed / NotRun |
| HAI-KZ-007 | `TestExportConsistentAuthorizedSnapshotAndRedaction` | Proposed / NotRun |
| HAI-KZ-008 | `TestProjectResolutionAliasesAmbiguityAndRevocation` | Proposed / NotRun |
| HAI-KZ-009 | `TestMCPPullSingleWinnerAndResponseLossReplay`；`TestMCPPullLeaseRenewalAndExpiry`；`TestMCPPullRejectsStaleFenceAndUnknownRetry`；`TestPushPullDispatchMutualExclusion`；`TestMCPAgentCannotCompleteWorkItem` | Proposed / NotRun |
| HAI-KZ-010 | `single-agent-delivery-and-interruption` 真實整合紀錄 | Proposed / NotRun |

每個切片須保存來源版本、實際命令／輸入、正反案例、獨立審查及未通過原因。
文件通過、切片通過、完整 P0-A 通過、真實 agent 日用通過分開標示。

## 6. 本次文件驗收

| AC | Given / When / Then | 驗證方式 |
| --- | --- | --- |
| DOC-01 | Given 現有 README/SUCCESS/traceability，When 讀取產品與啟動入口，Then 可區分現在可試用、P0-A 未完與未啟用的真 agent 工作台 | 交叉核對來源與歷史證據日期；不新增 runtime passing 宣稱 |
| DOC-02 | Given Kanzo 固定來源與 HAI 既有契約，When 後續開發者選取切片，Then 有條款、依賴、AC、具名 oracle 與停止點，且保留原 authority/Done/Fake 邊界 | 獨立設計審查；全部 HAI-KZ oracle 為 Proposed/NotRun |
| DOC-03 | Given 文件 diff，When 執行文件連結、契約／索引與範圍檢查，Then 無新增壞連結或非文件修改，並保存審查結果 | [文件驗證紀錄](../evidence/kanzo-usability-docs-20261029.md) 與 Draft PR |

本次不改 SUCCESS 的產品 AC 狀態、不建立 usable tag，不代表真實 agent 啟用或 merge/deploy 授權。

## 7. 公開參考來源

以下僅參考產品行為與設計取捨；本次未引入 Kanzo 程式碼、圖片或其他資產。

- [Kanzo README：啟動、MCP、快捷鍵、匯出與同步](https://github.com/emanuele-em/kanzo/blob/005424d4d0b4c2971278a14de6fbca6189605e6c/README.md)
- [MCP：工具、簡短回覆、project context 與 human 指示](https://github.com/emanuele-em/kanzo/blob/005424d4d0b4c2971278a14de6fbca6189605e6c/src/mcp.rs)
- [Store：Task 模型、原子 next_task 與狀態更新](https://github.com/emanuele-em/kanzo/blob/005424d4d0b4c2971278a14de6fbca6189605e6c/src/store.rs)
- [Sync：整庫同步與分歧處理](https://github.com/emanuele-em/kanzo/blob/005424d4d0b4c2971278a14de6fbca6189605e6c/src/sync.rs)
- [Security：localhost 與網路存取邊界](https://github.com/emanuele-em/kanzo/blob/005424d4d0b4c2971278a14de6fbca6189605e6c/.github/SECURITY.md)
