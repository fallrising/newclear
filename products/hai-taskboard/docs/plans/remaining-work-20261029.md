# HAI Taskboard 剩餘工作與後續設計計劃

日期：2026-10-29（UTC）。需求：T-0339；當次 owner 指示為「規劃、Claude review、依建議修訂、先交付文件」。
來源基準：`a2c0b5116018160d5e5c24c10fa49c81adff806e`。
狀態：**規劃文件，已依 Claude 意見修訂並通過修訂核對；所有下列未來實作均未啟動**。

本輪交付這份計劃及[審查／驗證紀錄](../evidence/remaining-work-plan-20261029.md)，不修改產品行為、既有 SDD／ADR、驗收門檻或授權。
本文件的合併只交付規劃，不代表提出的契約已接受，也不授權開始下一個里程碑。
產品完成仍由 [SUCCESS](../../SUCCESS.md) 判定；依現行 owner／repo 管理入口，執行狀態記在 [BOARD](../tasks/BOARD.md)。
這與已接受 SDD 的 bootstrap authority 條款有已確認衝突，見 §6；本輪不把該條款降格為歷史，也不另開狀態板。
下列 M／U／D 編號是工作拆分與依賴引用，不是另一份執行狀態板。

## 1. 現況與本輪文件驗收

| 層次 | 已有依據 | 尚未完成 |
| --- | --- | --- |
| 可試用的本機 Fake 流程 | 登入、project／Draft、明確接受規格、Ready／Fake、重送查回、重連；2026-10-23／24 有局部歷史證據 | Fake 成功停在 Developing；不能據此宣稱完成工作或完整產品 |
| 完整 P0-A | SUCCESS AC-01 passed；底層 completion／output／HTTP command 已有局部接受切片 | AC-02／03／04 pending；完整完成 UI、影響啟用、還原與 fresh-context 接續 |
| 後續日用設計 | Kanzo HAI-KZ-001..010；Question／Decision／Attention／ledger 提案 | 都不能視為已啟用功能；真 agent／MCP 不在 P0-A |

H01／H02／H03 的 `in_progress` 是舊執行紀錄；H04 是 `todo`。本輪不把舊時間改成正在實作，也不把歷史 PASS 當作新基準的實跑結果。
`mainline: incomplete`、`usable_tag: none`、原 AC 表與歷史 FAIL／PARTIAL／NotRun 均保留。

本輪只驗收三條文件 AC：

| ID | Given / When / Then | 證據 |
| --- | --- | --- |
| PLAN-01 | Given 現行來源與既有設計，When 盤點剩餘工作，Then H01..H04、十條 HAI-KZ 及 Decision／Attention／ledger 均有處置，已實作與待實作可分辨 | 本計劃 §2–6、來源引用及範圍檢查 |
| PLAN-02 | Given 接手者沒有前次聊天，When 選取下一片，Then 能找到輸入、依賴、可寫範圍、具體驗收與停止條件 | §3、§7–8；Claude 獨立審查與逐項修訂 |
| PLAN-03 | Given 修訂後文件，When 做連結／契約／diff 檢查與 PR CI，Then 文件可導航、原產品狀態未被改寫，且 Claude 意見都有結論 | [驗證紀錄](../evidence/remaining-work-plan-20261029.md)、PR checks |

## 2. 優先順序與依賴

先完成完整 Fake-only P0-A，再做日用便利功能，最後另行界定真實 agent 整合。
最先交出一條可由人操作的 Candidate → Review／Evidence → QA → Done 流程，但它只是中間成果；還原、接續與整組負向驗收仍是 P0-A 必需。

```text
M0 來源／驗收對帳
 ├─ M1 完成準備與材料 API ─┐
 └─ M2 AC／policy 邊界 ───┴─ M3 人工完成 UI ─┐
          └─ M4 持久影響啟用 ──────────────┼─ M5 完整四個操作面
                      └─ M6 備份／還原 ─────┴─ M7 ContextPack 接續
M1..M7 + 所有必需條款／測試 ── M8 獨立 P0-A 驗收
M8 ── U1 便利功能；D1/D2 實作另需接受後續契約
M8 + U2-POLICY + U2-CONTEXT ── U2-MCP ── U2-LIVE（另需 G2 授權）
```

- M1、M2 完成契約對齊後可分開執行；M3 依賴兩者的穩定 API／規則。
- M4 後端可在 M3 期間獨立前進；M5 的 impact 操作須等 M4，不能靠 UI 模擬啟用。
- M6 可先定 backup／restore 契約與測試，再以 M4 最終 schema／activation 及 M1c human-report material 做整合；M7 的還原接續驗收依賴 M6。
- 所有平行實作須各有獨立工作樹、互斥可寫範圍及獨立 reviewer；共享 API／migration 先由主導收斂。
- U1-ENTRY 的文件整理可提早做；其餘後續便利功能不插隊取代主線缺口。
- D1／D2 的設計修訂可與主線規劃並行；實作排在 M8 之後，除非 owner 明確調整。圖為摘要，具體依賴以各片文字為準。

## 3. P0-A 工作切片

以下驗收都是**未來需取得的證據**，不是本輪實跑結果。新測試名稱是提案；既有測試與條款名稱保留不改。
每片開工前，在同一 BOARD 登記新的有界技術任務，連回 desk 大需求 T-0339 與既有 T-0980 的對應 H01..H04 列，不另造第二套主線狀態。
本輪 HP01..HP03 只記文件交付。未來實作需記當時完整 source SHA，接受相關契約及具名測試骨架，再開始 Red → Green。
本節標題的 `SUCCESS:AC-*` 是產品 AC；正文細項以 `v0.2:AC-*` 或 `AC-P0A-*` 區分。

### M0 — 重新建立可相信的基準（H01；所有驗收命名空間）

- 輸入：SUCCESS、HANDOFF、traceability、現行 BOARD、已合併程式與歷史報告；不恢復已封存 `.team` 為現行 authority。
- 範圍／產物：只讀程式稽核及新的證據／任務記錄；建立「條款 → 接受狀態 → 實作入口 → 現行測試／僅命名 skeleton → 缺口 → 後續片」表，涵蓋 SUCCESS、v0.2、AC-P0A 與 §4 所有已接受 mini-SDD。校準基準版本、未完成與未驗證的區別。
- 驗收：同一 source 上執行 pinned backend／web gates 與既有 connected-browser foundation probe；登入→接受規格→Fake→重連仍成立，Fake 不變 Done。歷史 FAIL 不刪，新增失敗按根因拆片。
- 特別核對：`DescribeCompletion` 是材料快照，**不是** Done predicate verdict；board 的保守 coverage 不是測試失敗；OpenAPI 與實際 handler 不得混淆。
- 停止點：基準失敗先確認既有回歸／環境／本片缺口，不能靠改 AC 放行。規格來源衝突先提出差異；不藉此重寫所有舊文件。
- 本片單獨交付完整對照表、baseline gate 結果與衝突清單，包括 bootstrap authority 和 policy 錯誤分類；不綁 M1a 實作。Fake 的 capability 常數與 checkpoint fixture 已存在，但實際 runtime 宣告及 durable resume 仍須本片核對。

### M1 — 完成準備、Run 產出與人工報告邊界（H02；SUCCESS:AC-02）

- 依賴 M0。輸入：`backend/internal/application/service/completion_description.go`、Run output storage／consumer、既有 completion commands 與 OpenAPI。
- 範圍／產物：application port/service、httpapi、artifact adapter 及 API 契約的有界子片；接出 authenticated `DescribeCompletion` read、project／WorkItem／Run-bound output 列表及 artifact read；另立人工 report 的 seal／persist 契約。路由與 wire shape 先評審，這份計劃不發明已存在 endpoint。
- 人工報告必須先保存可驗證 bytes／digest／scope／actor，再可引用於 Review／Evidence。上限、允許 media type、重送、孤兒檔清理與 audit 先定案；不能讓瀏覽器自填「已驗證」artifact locator。
- 驗收：授權先於敏感查詢；跨 project、錯 Run、缺檔、digest 不符、active content／symlink 拒絕；同一 intent 重送不重建材料，restart 可讀原結果；快照讀後 subject 改變，舊快照不能完成工作。
- 預定測試：`TestCompletionDescriptionHTTP_ScopeAndStaleSubject`、`TestHumanReport_SealReplayAndScope`，兩個名字均 Proposed／NotRun。artifact confinement／transaction rollback 的現行測試名稱與有效證據由 M0 確認後選用，不預先宣稱通過。
- 分拆：M1a read API；M1b artifact/output access；M1c report storage／submission。不得混入通用檔案上傳、真實 verifier 或 provider。

### M2 — AC identity、policy 與目前有效證據（H02；SUCCESS:AC-02）

- 依賴 M0；與 M1 協調 wire contract。輸入：accepted AC 的 UTF-8 ≤120 bytes 契約、舊 `acPattern` 的 80-byte／ASCII 路徑、local-policy-v2、current subject／completion gate。
- 範圍／產物：先列每個 ingress 的 validator 與 policy coverage；規範接受／completion subject／evidence submission 的一致範圍，保留舊資料相容性。不得把更改一般 token validator 當成全部修復。
- runtime 目前 `local` AC profile 是有界基準。任意 accepted AC 的 policy 配置與持久來源若尚未定義，先接受獨立契約；不能替未知 AC 自動生成 Passing 規則或把所有 AC 映射成 `local`。
- 驗收：以 80／81／120／121 byte、合法多位 UTF-8、非法 UTF-8／控制字元／重複 identity 做端到端規格接受→證據→完成；缺 policy、過期 AC／recipe／environment、同 producer review 均不通過。
- detail／coverage 與 `CompleteWorkItem` 共用 authoritative predicate 及 material verification；`DescribeCompletion` 只能提供輸入。predicate 返回未滿足原因，讀取本身無狀態寫入。
- 錯誤分類須對回 HAI-API-001：現行 `completion_description.go` 缺 rule 回 `staleCurrentInput`。M0 釐清這是否為「binding 已過期」的既定語義，或與 policy rejection 區分要求衝突；M2 以接受後的缺 rule／stale subject／storage corruption 矩陣驗收，不直接把舊錯誤當正確規格。
- 預定測試：`TestAcceptedACIdentity_EvidenceAndCompletionBoundary`、`TestCoverageProjection_MatchesCurrentDonePredicate`（Proposed／NotRun），重跑現有 completion positive／negative suites。
- 停止點：若要更改既有已接受 AC／policy 語義，先提交精確規格差異；不能透過放寬 validator 掩蓋 identity 衝突。

### M3 — 可操作的人工完成流程（H02／H03；SUCCESS:AC-02／03）

- 依賴 M1、M2。範圍：web API client、detail UI 與同源整合 harness；後端新增行為回到相應契約，不在 UI 旁路修正。
- 產物：選擇真實 Candidate／Run output、閱讀材料、明確提交獨立 human Review／Evidence、轉入 QA、確認 exact subject 後 Complete。每個動作走既有 command/version/idempotency/recovery path。
- 驗收：真瀏覽器從 Draft 到 Done 的正向流程，以及缺 AC、A 的證據用於 B、過期 policy／subject、缺 report／artifact、自我驗證、Failed／Skipped／Unknown、舊 approval／integration base 的拒絕；拒絕保持 phase、輸入和焦點。
- 回應遺失以原 command identity 查回；session 切換、重連或 subject 更新不得套用舊請求結果。Fake 成功本身仍不會 Done。需要 Approval 時明確走政策，不偷偷開關 ApprovalRequired。
- 預定 `connected-completion-flow.spec.ts`（Proposed／NotRun）；人工作業證據要標明合成 Fake fixture，不能冒充真實專案成果。
- 分拆：detail read／選取 → report/review/evidence forms → QA／completion 與負向 browser tests；完成本片仍不宣稱 G1。

### M4 — 持久化 ImpactPlan 與依賴失效（H04／H02；SUCCESS:AC-04／02）

- 依賴 M0、M2。輸入：[accepted-spec-admission](../sdd/accepted-spec-admission.md)、[reconciliation](../sdd/reconciliation.md)、既有 pure reconcile kernel 與 ordered migrations。
- 範圍：durable preview／activation command、accepted bindings／graph、current-input consumer、API 與必要 migration。新的 migration 編號按當時 registry 分配；不得重用舊設計的 `0002`。
- 驗收：舊＋新 reverse closure 精確涵蓋被刪／轉向的邊；cycle／缺節點給 cause path；stale graph／policy／Run 讓 plan 拒絕且零局部寫入；同 intent replay 只啟用一次。
- 既有 Done 留歷史但變 ineffective；in-flight stale candidate 可留歷史，不能當新 subject 的成果；unknown Run 不重派。舊 Pending dispatch 在啟動前重新驗輸入，不混用新頭與舊 Run。
- 沿 `TestImpactActivation_RejectsStalePlan` 已登錄 oracle，補真正 SQLite／HTTP／重啟整合及 v0.2:AC-23..33、48 的證據，包含未授權 edge deletion／no-op proposal 不改 accepted graph（AC-32）。schema 存在、pure kernel PASS 都不能代替 durable activation。

### M5 — Board／Detail／Attention／Impact 四面串接（H03；SUCCESS:AC-03）

- 依賴 M3、M4；基本 blocker／unknown attention 投影可在後端契約穩定後先做。輸入：HAI-UX、[ui-interaction](../sdd/ui-interaction.md)、[connected-local-runtime](../sdd/connected-local-runtime.md)。
- 範圍：server projections／API／connected UI；Board-first 不改為活動牆。用目前權威 state 呈現 blockers、Run、coverage、Done-Stale、unknown、disconnected 與 exact impact subject。
- P0-A 已要求的 Question／Blocker 最小生命週期不能漏：提問停住工作、回答只解除對應 blocker，不自動重啟 Run。後續 D1 的 dedupe／多題 Decision／expiry 不默認併入 P0-A。
- **M5a executor checkpoint／WaitingHuman 子片**另有後端範圍：依 HAI-EXEC-008 核對 capability 與 binding；支援的 Fake durable checkpoint 重啟後必須重驗輸入／binding 才可明確 resume；不支援的 profile 中斷並要求新 Run，回答不自動 resume。驗收 v0.2:AC-19／20，不用 M7 的 ContextPack 測試代替。
- M5a 依賴 M0 及已接受 EXEC 契約，可先於 M3／M4 獨立執行；M5 整體 UI 接受仍須全部上游與 M5a 的整合證據。
- 驗收 retry budget／WIP 上限拒絕額外 execution、heartbeat 無進展產生 silence attention（v0.2:AC-21／22）；先由 M0 對應既有 policy 條款，不能在 UI 硬編碼新政策。
- 驗收：Attention 每個項目有 reason 與可操作 subject；完成提示與 Done predicate 一致，不能把 preparation snapshot 當成已通過。Impact preview→明確 activation→所有 affected views 一致；SSE gap／reset／revoked session／slow consumer 不漏變更或阻塞 command。
- 真 Chromium：320px、平板／桌面、light／dark、原生 browser zoom、全鍵盤、coarse pointer；點擊／鍵盤／拖曳共用 guards，rejection/refetch 後焦點正確。fixture 截圖與 CSS zoom 不能代替。
- 擴充既有 connected browser oracles；全 HAI-UX 與 v0.2:AC-49／50 有現行來源證據後才能關本片。

### M6 — 備份、還原、材料完整性與容量（H04；SUCCESS:AC-04）

- 依賴 M4 最終資料邊界與 M1c report material／retention，與 M5 可分開實作。所有 human reports 須納入 manifest／restore validation。輸入：[persistence-and-recovery](../sdd/persistence-and-recovery.md)、ADR-005、現行 migrations／artifact store／SSE。
- 產物：一致 SQLite snapshot＋schema／high-water／artifact manifest；verify／restore／projection rebuild 與明確 enable。只在隔離測試資料測還原，不覆寫 operator 真實資料。
- 驗收：缺物件／digest 損壞／migration 中斷／disk full／SQLITE_BUSY 不產生半筆 accepted state；Missing／Quarantined 可追溯，相關 Done 被擋；保留 audit／CompletionRecord。
- 還原起始停 dispatch，持久 restore generation 前進且 stream epoch 輪換；舊 callback／claim／cursor 被拒絕或要求 reset；unknown side effects 不重跑；完整材料驗證後仍需明確 enable。
- 實作已登錄但 NotRun 的 `TestRestore_VerifiesArtifactDigestAndRebuildsProjection`、`TestSSE_RestoreEpochMismatchRequiresReset`、`TestRestore_FencesPreRestoreCallbacksAndDispatch` oracle，分別對應 AC-P0A-011／015／016；加入真實兩程序 restore／failure injection，不假設已有可跑完整測試。
- 容量與 retention：先記錄代表性資料數／DB size、board/replay latency、recovery/backup/restore duration，再接受有數值的門檻；不憑空承諾效能。測 retention reset、live reference 保留及孤兒回收 grace period。
- 分拆：backup／manifest → restore/fencing → material disposition／rebuild → capacity/retention；每片各有負向與 rollback 證據。

### M7 — 無舊聊天的 ContextPack 接續（H04；SUCCESS:AC-04）

- 依賴 M5、M6。範圍：bounded read/generation、持久 state references、handoff UI／文件與 fresh-process probe；不引入 MCP。
- 契約先定明：pack 綁定 project／WorkItem／accepted inputs／policy／candidate／restore generation／high-water；長度與截斷策略有上限，缺關鍵欄位必須拒絕或提供可追溯分頁，不能靜默隱去 blocker。
- 驗收：新的 operator context 只讀 pack＋durable references，可找出 current objective、blockers、證據缺口與下一個允許動作；改 spec／policy／restore 後舊 pack 要求 refresh；秘密 canary 不洩漏。
- 實作 AC-P0A-014 已登錄但 NotRun 的 `resume-without-chat.spec.ts`；`TestLogsAndContextPack_RedactSecretCanary` 只在 executor-and-security 規格命名，本次來源搜尋未找到同名 backend/web 實作，仍 NotRun。涵蓋正常重啟、還原後、未知 Run 與缺 material 四情境。記錄實際 reader 輸入與判定，不以生成一份 Markdown 視為接續成功；adapter checkpoint resume 屬 M5a。

### M8 — 完整 P0-A 獨立接受（H01..H04；SUCCESS:AC-01..04）

- 依賴 M1..M7 及所有必需條款，含 §6 authority 衝突的明確裁定。輸入：同一候選 SHA、完整 diff、M0 的完整條款／oracle 清單、更新 traceability、原失敗與修復鏈、命令／環境／exit／CI evidence。
- 按 [HTB-P0A-005](../tasks/HTB-P0A-005-evidence-gate.md) 由非實作者獨立檢查；reviewer 不自行修正。實作者修正後只重驗受影響部分，再核對最終整合基準。
- 覆蓋 backend full／race／vet／build、web unit/type/lint/format/build、少數關鍵真 browser journeys、failure injection、backup／restore、fresh-context resume。繼承歷史證據須能證明相關 source/environment 未變，否則補驗。
- 所有必需條件有現行 PASS 才更新產品 AC 與主線；必要 Failed／Skipped／NotRun／Unknown 都擋完整完成。PR 合併不自動等於 owner 驗收、usable tag 或 deploy；後兩項另需授權。
- 測試通過提供 G1 候選依據；還需依現行契約完成獨立審查與主導接受，不能只以 test exit 0 宣告 G1。

## 4. 驗收登錄不能遺漏

`SUCCESS:AC-01..04` 是四條產品主線；`v0.2:AC-01..54` 是 traceability 的細項；`AC-P0A-001..016` 是已命名 G1 skeleton，三者不是同一組 ID。
下表是覆蓋路由，不改原條款內容或狀態。M0 逐條補實際測試位置，M8 核對完整 registry；原「minimum」不是其餘條款可自行取消的理由。

| v0.2 細項 | 主要工作片／處置 |
| --- | --- |
| AC-01..06、29、30、47、48 | M1／M2／M3，加 M4 的 stale/invalidation；完成正向與全部負向 |
| AC-07..11 | M0 基準，M1／M4 的 command 原子性與 concurrency，M8 最終整合 |
| AC-12..16、53 | M0 既有 Fake recovery 重驗，M4／M6 durable fence／restore |
| AC-17、18、21、22 | M5 Question/blocker／retry budget／WIP／silence attention；M0 對照已接受 EXEC 條款，不能因不在 minimum 而略過 |
| AC-19、20 | M5a adapter checkpoint／WaitingHuman／resume profile 與 binding 重驗；不是 M7 ContextPack |
| AC-23..28、31..33 | M4 import／graph／activation |
| AC-34 | M6 projection rebuild；與 M4 的 activation 結果做整合 |
| AC-35..37 | M5 實際 session/SSE，M6 restore epoch |
| AC-38、39 | M0 對照既有 sink／通知契約，M5 檢查 in-process 去重／bounded failure；不藉此新增 Slack／Lark。若現行條款與 P0-A 邊界不一致，先提交具體釐清，未裁定保持 NotRun |
| AC-40、41 | M6 備份／容量／失敗注入 |
| AC-42..46 | M1／M5／M6 Fake denial、授權、材料、approval；不是實際 provider sandbox 證據 |
| AC-49、50、51 | M3／M5 UI 與 M7 fresh context |
| AC-52、54 | 原本 Deferred，留 U2-LIVE／G2；不算 P0-A passing |

同時檢查 HAI-BOUNDARY／AUTH／DOMAIN／STATE／DONE／EXEC／RECON／API／UX／SEC／OPS／DELIVERY 全族，不能只跑上表中的 happy path。

| G1 skeleton ID | 主要工作片／尚缺證據 |
| --- | --- |
| AC-P0A-001..003 | M1／M2／M3：保留底層 gate PASS，補 connected 全正負路徑 |
| AC-P0A-004..006 | M0／M4／M6：idempotency、stale epoch、expiry；006 durable integration 仍 NotRun |
| AC-P0A-007..008 | M4：pure graph kernel 外的持久 activation／stale plan |
| AC-P0A-009..010 | M5／M6：transport 外的 real-Store／transaction／restore 整合，不能繼承 seam PASS |
| AC-P0A-011、015、016 | M6：material verification、restore epoch／callback fencing，完整 oracle NotRun |
| AC-P0A-012..013 | M3／M5：fixture 外的真實 browser/accessibility／recovery |
| AC-P0A-014 | M7：fresh-context oracle NotRun |

M0 還要以原文的**逐條接受狀態**盤點下列 mini-SDD；同檔有已接受與未接受條款時，不因表列而整檔升級為 Accepted。無 clause ID 的條款以檔案／章節與 named oracle 定位。M8 用相同清單核對：

| mini-SDD 來源 | 路由 |
| --- | --- |
| [domain-and-gates](../sdd/domain-and-gates.md)、[fake-vertical-slice-implementation](../sdd/fake-vertical-slice-implementation.md) | M0..M3／M8，domain、state、Done 與 application 原子性 |
| [executor-and-security](../sdd/executor-and-security.md)、[runtime-integrity-predecessors](../sdd/runtime-integrity-predecessors.md) | M0／M1／M5a／M6，Fake、artifact、identity 與完整性 |
| [local-fake-runtime](../sdd/local-fake-runtime.md)、[persistent-fake-runtime](../sdd/persistent-fake-runtime.md) | M0／M5／M6，本機 process、poller、持久 projections |
| [ordered-migrations](../sdd/ordered-migrations.md)、[acceptance-persistence-schema](../sdd/acceptance-persistence-schema.md) | M0／M4／M6，既有 runner/schema 接受範圍與升級 rollback |
| [accepted-spec-admission](../sdd/accepted-spec-admission.md)、[proposal-import-core](../sdd/proposal-import-core.md)、[durable-proposal-command](../sdd/durable-proposal-command.md)、[initial-specification-command](../sdd/initial-specification-command.md) | M0／M2／M4，固定 Git object、proposal、acceptance 與未完 activation |
| [current-specification-inputs](../sdd/current-specification-inputs.md)、[run-output-provenance](../sdd/run-output-provenance.md) | M1..M4／M6，Run inputs／outputs、current subject 與 provenance |
| [connected-local-runtime](../sdd/connected-local-runtime.md)、[ui-interaction](../sdd/ui-interaction.md) | M0..M3／M5，HAI-CONNECT 等已接受條款與未完 UI 驗收 |
| [reconciliation](../sdd/reconciliation.md)、[persistence-and-recovery](../sdd/persistence-and-recovery.md) | M4..M7，graph、backup/restore、fencing／handoff |
| [decision-attention-ledger](../sdd/decision-attention-ledger.md) 的 HAI-CI-001 | M0／M8，既有 CI 接受切片；其餘 Proposed 留 D1／D2 |
| [kanzo-inspired-usability](../sdd/kanzo-inspired-usability.md) | U1／U2；全部後續 Proposed，不能算 P0-A coverage |

相關 ADR-001..006 及 OpenAPI 契約一併作接受依據；M0 不只列文件名，須交出逐條 scope／test／缺口對照。

## 5. 尚未實作的既有設計

### D1 — Question／Decision 後續設計

[decision-attention-ledger](../sdd/decision-attention-ledger.md) 只有 HAI-CI-001 已接受；Decision／Attention／ledger 條款仍 Proposed。
先用設計修訂片釐清 Decision scope 與原 blocker 對應、duplicate linking、多題原子回答、spec-change stale、是否需要 expiry，以及「回答不是執行授權」。
最小 Question／Blocker 先按既有 P0-A HAI-EXEC-008 完成（M5）；D1 不得擋住它，也不得省掉它。
後續契約接受後才實作新 records/migrations/commands；驗收沿 HAI-DEC-001..006，補 stale／duplicate response、跨 scope／只解除一個 blocker、無自動 Run 的負向測試。
舊建議使用 migration `0002` 已過時；本次基準 `a2c0b511` 的 `backend/internal/domain/sqlite/migrations/` 有 0001..0004，須按開工來源分配新序號。

### D2 — Attention 擴充與 desk 唯讀 mirror

- M5 已涵蓋 P0-A 真實 Attention；後續 HAI-ATTN 的完整 category／ack cursor／queue policy 需先定接受範圍，並依 D1 加入 decision-needed。不得另造一份 Attention authority。
- ledger import 先接受版本化 profile：現行 desk 已是大需求卡與 `todo/in_progress/done`、claim/spec/project_board references，舊 goal→plan→task 與 doing/review mapping 不能直接使用。此處只描述公開格式；測試用合成資料，不把私有卡內容搬到 public repo。
- 建議新 profile 整體取代舊 HAI-LEDGER-004 的 native phase mapping，以外部 status 原文標籤顯示，先接受修訂再實作；本輪不自行宣布舊提案已作廢。`todo` 不等於 native Ready；`in_progress` 不等於 Developing／有 Run；`done` 不等於 HAI CompletionRecord；desk claim reference 不等於 HAI claim／lease／Run。UI 明示 external authority／來源 commit，全部 mutation 包括派工都拒絕。
- 驗收：immutable commit/profile identity、跨 project 授權、schema 不支援的拒絕、刪除／移到 archive 的全快照語意、N→N+1 原子替換、response-loss replay、HTML/指令作資料、零回寫。
- 若 owner 之後要移交 authority，另開一次性 per-project migration 決策；不在 mirror 或本次文件範圍。
- HAI-LEDGER-005 對 `.team` bootstrap rule 的引用也須隨 §6 authority 裁定更新，不能從舊引用推定 SQLite authority 已移交。

### U1 — 日用便利功能

條款來源：[Kanzo-inspired usability](../sdd/kanzo-inspired-usability.md)。全部仍 Proposed／NotRun；本計劃不重新接受其規格。

| 切片 | 條款／範圍 | 依賴及驗收 |
| --- | --- | --- |
| U1-ENTRY | HAI-KZ-001，本機入口、Fake 模式、停止／沿原資料重啟 | 文件可先整理；behavior 另領。乾淨環境按單一配方完成 Fake／重啟，缺依賴／port／設定診斷清楚；不聲稱 zero-setup 發行版 |
| U1-CAPTURE | HAI-KZ-002，標題快速建 Draft／收集視圖 | M8 後；沿 CreateWorkItem，Title→暫定 Goal，OwnerID 由驗證 operator；明傳 `required_ac_revisions: []`。同 intent 只一筆 Draft，未接受規格不可派工 |
| U1-SEARCH | HAI-KZ-003，有界搜尋／canonical detail | M8 後、detail 完整；ID/title/project/phase、20 預設／100 上限、穩定 pagination／scope、鍵盤不搶編輯焦點、無 DB mutation |
| U1-NOTES | HAI-KZ-004，追加註記／既有 artifact 引用 | M8 後及 M1 邊界；principal／scope／digest／重送可查，修正另追加；文字「完成」不能滿足 Evidence／Done；暫不做圖片上傳 |
| U1-EXPORT | HAI-KZ-007，唯讀 JSON／Markdown snapshot | M8 後；一致版本／high-water、可讀欄位、敏感資料排除、並行更新不混版；不是 backup，不匯入回寫或 git push |

U1-CAPTURE／SEARCH 可在既有契約穩定時分開；NOTES／EXPORT 各自有 bounded task，不能為便利功能擴權或新增 phase。

### U2 — policy、MCP 與一個真實 agent

| 切片 | 條款／範圍 | 依賴、驗收與停止點 |
| --- | --- | --- |
| U2-POLICY | HAI-KZ-005，human-only server policy、principal／action scope | M8 後，先接受 policy/auth/migration ADR。agent 不能自解限制；active/unknown Run 下拒絕不相容變更；UI 隱藏不算權限 |
| U2-CONTEXT | HAI-KZ-006／008，精簡結果與核准 repo→project 解析 | policy/principal 邊界已接受。回覆保留 command/version/fence/error/recovery；SSH/HTTPS alias 僅唯一核准 binding 可選，無候選／多候選／撤銷都拒絕或要求選擇，不自建 project |
| U2-MCP | HAI-KZ-009，薄 transport＋Fake contract | M8、U2-POLICY／CONTEXT 及獨立 MCP 授權；先接受 external-pull ADR。claim/outbox/Run 原子、push/pull 互斥、start ACK 與 phase 分離、有效續租、過期 fence／unknown 不重跑、原結果查回；不得借 operator credential |
| U2-LIVE | HAI-KZ-010＋v0.2 AC-52／54，單 client／project／任務 | M8、所選 adapter/MCP contract 及 G2 明確授權；先定 provider terms、credential/host/network scope、成本／停止條件。真成果＋獨立 evidence＋operator completion及中斷恢復；不以 Fake 或 CLI exit 0 代替 |

MCP 不是新增任意 status-update 或 delete 的入口；client 不能 CompleteWorkItem。真 agent 可以採用日後核准的 adapter 路線，不能因本表把 MCP 接通視為真實執行已驗收。
多 provider、多人 RBAC、Slack／Lark、跨 project／跨機離線合併、服務自動安裝更新、GitHub 雙向同步、release／deploy 保留在未承諾範圍；有明確需求再單獨設計。

## 6. 開工前要解決的具體決策

| 決策 | 建議與影響 | 最遲停止位置 |
| --- | --- | --- |
| SDD §4 bootstrap 列／HAI-DELIVERY-004 與現行 BOARD 的權威衝突 | 已確認衝突。建議以精確 SDD 差異將 bootstrap 狀態入口改為 BOARD，保留未發生 SQLite migration 的事實；另核對 HAI-LEDGER-005 舊引用。由 owner 按規格變更流程裁定，本輪只記錄 | M0 列出差異；M8 前未裁定則該條保持衝突／NotRun，不宣稱 G1 |
| 一般 accepted AC 與 runtime policy 的配置／持久來源 | 保留 local 基準；補明確的通用契約，缺 rule 一律拒絕，不自動接受任意 AC | M2 production change 前 |
| report API 的 byte/type/size／storage／retention | 沿現有 digest-addressed store；人明確提交、有界且可重送，證據判定分離 | M1c 前 |
| Decision expiry／dedupe／多題 scope | P0-A 最小提問先完成；便利性 Decision 條款另審，不自動授權 Run | D1 前 |
| ledger profile 與 archive/tombstone 語意 | 固定版本及 immutable snapshot；拒絕舊格式假設，不用 native phase 推導執行權 | D2 import 前 |
| capacity／ContextPack 限額 | 先量測代表性環境，提出具體數值與失敗行為；不得以「有界」取代數值 | 相關 behavior／測試預期鎖定前；容量驗收前再核對實測 |
| agent 身分、human-only、external pull | 獨立 principal、可撤銷 scope、原子 claim 與 push/pull 互斥；缺 ADR 不實作 | U2-POLICY／MCP 前 |
| 真實 adapter 與外部資源 | owner 選定一條 bounded G2 路線及成本／權限；不在本輪啟用 | U2-LIVE 前 |

工程細節若可由既有契約推出，由接手者直接整理；只有改變需求／權限／驗收或尚未接受的規格，才提交具體選項與差異供決策。沒有答覆不是批准。

## 7. 驗證、拆工與交付方式

每個 M 大片再拆成約 30–90 分鐘可交付的工作單位；這是規劃估算，不能據此聲稱整體工期。
目前缺重新基準與 report/policy/restore 的定案，整體投入維持 unknown；M0 完成後才更新估算與瓶頸。
依當時適用的執行規則定期核對新證據、阻礙、投入與預估差異；重試達界線仍無進展就停止該路線並交接。必要驗證與 PR 收尾在原授權內完成。

有界任務至少提供：需求 T-0339、source SHA、輸入條款、唯一目標、可寫 paths／排除範圍、AC 與命令、reviewer、timeout／重試界線、證據位置。
只有主導可改 BOARD 的整合接受；worker 不遞迴委派、不提交外部內容。平行度由互不衝突範圍決定，不預設大量 workers。

| 變更 | 最小有效驗證，再加必要整合 |
| --- | --- |
| command／schema／artifact | 一個有意義 Red、domain/service＋real SQLite/HTTP regression；affected failure injection；pinned backend gate |
| UI／transport | component／API contract，再跑關鍵 actual Chromium 路徑；pinned web gate；新 API 需 backend 整合 |
| activation／restore／resume | deterministic graph/state tests＋真實兩程序／故障注入／fresh-context；不能只用 E2E happy path |
| 文件 | local links／coverage mapping／unchanged accepted criteria／whitespace，native project-success/index checks，獨立 review；不新增模仿文件內容的產品測試 |

本輪 Claude 的模型／effort、工具限制、timeout、呼叫預算與實際觀測放在[審查紀錄](../evidence/remaining-work-plan-20261029.md)。
root 負責逐項處置、實際修改與最後 evidence gate。模型呼叫成功不等於文件被接受；所有未解阻擋保持可見。

## 8. 文件交付後的唯一下一步

先由 owner 決定是否開始 **M0 基準對帳**，作為獨立 bounded task：交出完整條款對照、baseline gate 結果與衝突清單，不改 production behavior。
開始前將有界 assignment 登記到 BOARD 並連回 H01。M0 關閉且 M1a 契約／測試骨架接受後，再另行開啟完成準備的 authenticated read API；不能把這兩片綁在一次隱含授權內。
本輪停在經 Claude 審查並修訂的文件交付，不因文件合併啟動上述實作。

## 來源

- [SUCCESS](../../SUCCESS.md)、[BOARD](../tasks/BOARD.md)、[HANDOFF](../HANDOFF.md)、[traceability](../traceability.md)。
- [Accepted P0-A SDD](../SDD.md)、[Fake vertical slice](../tasks/HTB-P0A-003-fake-vertical-slice.md)、[restore/handoff contract](../tasks/HTB-P0A-004-reconcile-restore-handoff.md)。
- [Kanzo follow-up](../sdd/kanzo-inspired-usability.md)、[Decision/Attention/ledger](../sdd/decision-attention-ledger.md)。
- `.team` 已封存且現行管理入口是 BOARD，未發生 SQLite dogfood authority migration；已接受 SDD 的 bootstrap 規範尚未同步，屬已確認來源衝突，按 §6 保留並裁定，不以「歷史敘述」消解。
