# M0 規格衝突與下一片契約提案

日期：2026-10-29。T-0339 / HM0，來源 `1e70824e24161bafacfc1eca33bb31ba7045df5a`。
狀態：**C01／C02／C06 已由 owner 於 2026-10-30 明確批准；C03／C04／C05 仍依後續切片處理。**

以下保留 2026-10-29 的提案原文與當時 NotRun；批准不追溯改寫歷史證據。
現行精確 M1a 契約見 [completion preparation](../sdd/completion-preparation.md)，工作狀態見 [BOARD](../tasks/BOARD.md)。

本提案把 M0 發現收斂成可審查差異。完整來源／測試證據見 [M0 報告](../evidence/m0-baseline-20261029.md)
與三份矩陣。依 desk 運作方法 §0／§4，修改已接受 SDD 需 owner 同意；本輪保留原文和原 NotRun，先完成不依賴決策的 M0 驗證與交付。

## C01 — bootstrap 工作狀態權威

原文位置：

- [SDD §4](../SDD.md#4-authority-and-transactional-model) 表格：`Bootstrap execution status | .team/PLAN.md | One-time switch to SQLite; never bidirectional synchronization`。
- SDD `HAI-DELIVERY-004`：mutable bootstrap execution status only in `.team/PLAN.md` until explicit SQLite migration。
- [ADR-001 Decision](../adr/ADR-001-authority-and-persistence.md#decision) 和 [ADR-006 Decision](../adr/ADR-006-repository-and-delivery-authority.md#decision) 同樣指定 PLAN 為唯一狀態來源。
- 現行 root AGENTS 技術任務合約與 [BOARD](../tasks/BOARD.md) 指定 `docs/tasks/BOARD.md`；原產品 `.team` 已移 journal archive，不能再寫。

建議精確修訂：

1. SDD §4 bootstrap 列改為 `docs/tasks/BOARD.md`；Rule 改為「Current repository bootstrap work status; any future migration to SQLite requires an explicit authority decision; never bidirectional synchronization」。這只對齊 repo 開發帳，不更動產品 SQLite operational authority，也不宣稱 SQLite migration 已發生。
2. `HAI-DELIVERY-004` 改為：「Product task contracts `docs/tasks/HTB-P0A-*.md` are immutable inputs. Current bootstrap execution status is recorded only in `docs/tasks/BOARD.md`. Root `.team/PLAN.md` records routing, review and acceptance rationale; the archived product ledger remains immutable. A future migration of execution-status authority to SQLite requires an explicit decision.」
3. ADR-001／006 的 bootstrap 段落以同一規則同步；保留歷史採用日期，追加新決策日期／依據，不重寫歷史接受結果。
4. [HANDOFF](../HANDOFF.md) 的舊「archived PLAN wins on disagreement」優先規則同樣必須在這次 authority 修訂對齊：封存 PLAN 保留歷史接受證據，現行工作狀態以 BOARD 為準，不能把封存檔重新提升為可寫權威。
5. [decision-attention-ledger](../sdd/decision-attention-ledger.md) `HAI-LEDGER-005` 仍是 Proposed；更新其 bootstrap 引用時不得順帶接受 Decision/Attention/desk import。

影響：解除 M8 的文件權威矛盾；不改產品程式、desk 大需求責任或 H01..H04 完成狀態。若未同意，矩陣繼續標衝突，不宣稱 G1。

## C02 — M1a 完成準備 read API 與 policy 錯誤分類

現況：`Service.DescribeCompletion` 已回傳 exact material snapshot，讀取兩次並在 artifact I/O 後比較身份；沒有 HTTP route。它**不是** Done predicate verdict，也不預留完成權。`readCompletionPreparation` 和 current-input guards 有既有局部測試。

[SDD HAI-API-001](../SDD.md#8-api-and-projection-contracts) 要求 validation/conflict/stale/policy/gate/storage 各有穩定分類。現況沒有專用 policy rejection code；缺 `Completion.Checks[ac_id]` 或缺 environment digest 會在準備路徑回 `stale_subject`，其他 policy 路徑可能回 lifecycle/gate 拒絕。不能把增加 HTTP handler 當成已解決此差異。

建議 M1a 先接受以下窄契約與 named skeleton，再實作：

| 項目 | Proposed 契約 |
| --- | --- |
| Route | `GET /api/v1/projects/{project_id}/work-items/{work_item_id}/candidates/{candidate_id}/completion-preparation` |
| Authority | 沿用既有 local session、project-scoped authorization、canonical path、Origin/Host 與不洩漏資源存在性規則；任何 material lookup 前先驗證身份；不引入新權限 |
| Capability | 透過窄 application reader port 接現有 service；缺 capability fail closed，不能 fallback 成 fixture 或猜測 subject |
| Response | 沿用現有 `DescribeCompletion` wire snapshot：expected_version、phase、completion_subject/digest、lease_epoch、restore_generation、approval_required、verification_rules；strict schema，`Cache-Control: no-store` |
| Semantics | 回傳只表示當時材料與 exact subject，不回 `can_complete=true`、覆蓋率或 Done 承諾；完整 command 仍在 transaction 重驗 |
| Stale | 兩次讀取間 accepted binding、candidate、run authority、policy revision 或材料變動仍回既有 `stale_subject`；無寫入 |
| Policy | 身份仍 current，但 required AC 缺 verification rule 或有效 environment binding，提議穩定 `policy_rejected`（HTTP 409）＋可辨理由 `verification_policy_incomplete`；這是待接受的新 wire code，現行沒有此 code |
| Error precedence | auth/canonical/scope first；無法解碼或不一致持久材料視為 storage corruption；captured/current identity（含 policy revision）已不一致時即使又缺 rule 仍 stale；只有 identity current 才把 missing rule/environment 分類 policy rejection。擬測 simultaneous stale+missing-policy，避免分類依 helper 呼叫順序漂移 |
| Other errors | 保留既有 canonical validation、not found、storage corruption 與 transport unavailable 分類；精確 envelope 需與 OpenAPI 對齊，不能直接暴露内部錯誤 |
| Bounds | 使用既有 records/artifact byte bounds；不在準備 API 建立人類 report、寫 evidence 或改變 phase |

擬定測試（均 Proposed／NotRun，M0 不建立空測試冒充執行）：

- `TestCompletionPreparationHTTP_AuthScopeAndNoStore`：身份拒絕發生在 material read 之前；跨 project/item/candidate 不洩漏；合法 snapshot 不快取。
- `TestCompletionPreparationHTTP_ExactSnapshotWithoutWrites`：真 SQLite exact subject/metadata；phase、version、audit、outbox、result count 不變；不提供 Done verdict。
- `TestCompletionPreparationHTTP_StaleAndPolicyRemainDistinct`：材料變動和配置缺失各有不同 code；兩種都沒有 mutation；不能把過期 artifact 誤報 policy。
- `TestCompletionPreparationHTTP_StrictBoundsAndCapability`：canonical route、完整 nested response、容量和缺 reader capability fail closed。

M1a 排除 artifact read、human report persistence、coverage、任意 policy 管理和完成 UI；分別留 M1b/M1c/M2/M3。建議先接受 C01＋C02，之後開一張獨立 M1a 任務；本輪沒有偷偷變更 SDD/OpenAPI。

## C03 — 已接受 AC identity 的實作不一致

初始 admission／completion subject 接受 UTF-8 最多 120 bytes；legacy CreateWorkItem decoder 是 ASCII80，`CanonicalPublishFixtureEvidence` 的 ACID 上限仍80。這是已接受 identity 沿 consumers 不一致的實作缺口，先以 M2 的 exact bytes／Unicode／81–120 bytes／空值／控制字元矩陣重現；不藉修復把既有上限再放寬。若精確規格對照顯示需變更已接受語義，再另列改文。M1a 不順帶修這組 validators。

## C04 — Fake runtime capability 超出持久實作

`newLocalFakeAdapter` 的 actual declaration 含 `durable_checkpoint`，但 persistent worker 僅執行 `local-success`；沒有 durable checkpoint/resume command、跨 process Session 或 WaitingHuman 流程。Fake package 的 checkpoint fixture 不代表 runtime 支援；artifact publication consumer 也只接受 terminal-success bytes。

M5a 必須讓 capability 宣告與實際支援一致，並完成 unsupported profile fail-closed/new Run 與 restart binding revalidation（v0.2:AC-19/20）。建議在 durable 實作接受前移除 runtime 的過度宣告，Fake package 的 fixture 能力保留；這是 M5a 待寫的具名回歸，不在 M0 改碼。不能以 ContextPack M7 代替執行器 checkpoint 義務。

## C05 — notification sink 的 P0-A 範圍

v0.2:AC-38/39 要求 lost sink acknowledgement 去重與 bounded/dead-letter notification，而 SDD §2 排除 Slack/Lark/webhooks；現行 source 沒有獨立 sink worker。SSE 的 backpressure/epoch tests 不等於 notification delivery。

建議在 M8 前明確選用**僅本機 deterministic test sink**驗證 durable outbox delivery，不接外部通知或新 provider；先另立 accepted mini-SDD 的身份、ack-loss、retry budget、dead-letter 與 source command 不重做契約。若 owner 決定把整個 notification obligation 延後，須修改接受依據並保留原 NotRun，不能自行把它歸為已排除或已通過。

## C06 — artifact preflight 與 commit 次序文字衝突

[Fake vertical contract §4](../sdd/fake-vertical-slice-implementation.md#4-command-transaction-and-failure-seams) 寫「No adapter dispatch, filesystem hashing/publication, Git traversal or SSE socket write occurs before commit」，下一句卻要求 bytes 在 later binding transaction 之前 staged/fsynced/hashed/renamed。已接受 INTEGRITY-003／PROPOSE-002 及現行程式均有 outside-lock preflight。

建議精確替換前句為：「Adapter dispatch and externally visible projection delivery occur after durable command commit. Immutable artifact/Git preflight may occur before the binding transaction, outside SQLite writer locks; the final transaction rechecks current authority and captured material identity. Publication without a committed binding remains an orphan and confers no authority.」保留原 transaction 步驟與歷史證據，禁止把 expensive I/O 搬進 writer lock。這是待接受的文字對齊，M1a 沿現行 accepted INTEGRITY snapshot/recheck 模式；M4/M6 也需核對。

其他歷史 parent prose（admission current-input Proposed、proposal execution pending、V4 REWORK、local-runtime unavailable worker/projections）的精確位置與後來接受子片，見兩份矩陣的 conflicts。建議加日期與 superseding child 引用，不能大批刪掉原始失敗、把整份父契約改成全通過或暗中接受剩餘 activation/restore。

## 下一個決策

本輪只完成 M0。C01 是既有規格矛盾的精確對齊；C02 是 M1a 的新 API/錯誤契約，須先經 owner 同意和獨立契約審查。C03/C04 是後續既定切片的具體缺口；C05 在 M8 前裁定，不阻擋獨立的 M1a 準備工作。任何同意都不追溯改寫歷史失敗或整條產品 AC。
