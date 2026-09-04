---
document_id: PROTOCOL-LLM-EXECUTION
version: 1.0.0
status: approved
authority: execution-process
---

# LLM Agent 執行協議

## 1. 目的

本協議將 SDD node 轉成可執行任務，並規定 LLM agent 在 contract、測試、程式碼、驗證與交接上的行為。Agent 的目標不是「寫最多程式碼」，而是以最小變更交付 node 的可驗證結果。

## 2. 啟動條件

Agent 只可領取 `docs/graph.yaml` 中符合以下條件的 node：

1. 所有 `depends_on` 狀態為 `done`。
2. Node front matter 的 `source_sha256` 等於目前 `SPEC.md` SHA-256。
3. Node 狀態為 `ready` 或被 orchestrator 明確指派。
4. Dependency contract 已凍結。
5. 沒有相同 `allowed_paths` 的其他 active owner。
6. 前一 milestone gate 已通過；收尾修復例外。

任一條不成立，agent 必須回報 blocker，不得以假設「依賴已完成」繼續。

## 3. 最小讀取集

開始前必讀：

1. `SPEC.md`。
2. 目標 node spec。
3. `docs/graph.yaml` 中直接 dependency。
4. 直接 dependency 的 contract 與 verification summary。
5. 本協議與 document change protocol。

不得把完整聊天紀錄、所有歷史 PR 或整個 legacy repo 當作必要上下文。需要 legacy 移植時，只讀 node `legacy_reference` 指向的局部模組。

## 4. 規格檢查 Gate

在產生程式碼前，agent 必須寫出：

- Node objective 的一句話重述。
- 所有輸入、輸出與不變量。
- 可執行 BDD 清單。
- 未定義詞、矛盾、缺少 contract、缺少測試 oracle。
- 前置事實證據：dependency build/test/contract 實際可用。

若存在 material ambiguity：

1. 在 implementation plan 加 `spec_defects`。
2. 停止受影響 task。
3. 修改擁有該事實的權威文件，或建立 ADR。
4. 更新版本、hash 與所有失效衍生文檔。
5. 不得只在程式碼選一個行為。

`SPEC.md` 已提供預設裁決規則；能依該規則唯一推出答案時可直接採用，但必須在 plan 記錄推導。

## 5. 衍生文檔順序

每個 node 必須依序產生：

```text
docs/tasks/{ID}/
├── 00-implementation-plan.md
├── 01-test-plan.md
├── T01-*.md
├── T02-*.md
└── ...
contracts/locks/{ID}.json
docs/verification/{ID}.md   # 完成時
```

### 5.1 Implementation plan

必須包含：

- 現況盤點與可重用代碼。
- 架構切面與資料流。
- Contract 清單。
- Migration 影響。
- 風險與 failure injection。
- 檔案 ownership。
- Task DAG。
- Rollback/revert strategy。
- 明確非範圍。

### 5.2 Test plan

必須把每條 BDD 映射到自動測試或人工 gate，並列出：

- Test level。
- Fixture。
- Oracle。
- Red state。
- Green condition。
- Negative/failure case。
- Performance/security evidence。
- 執行命令。

### 5.3 Task card

每張 task：

- 15–90 分鐘。
- 一個主要結果。
- 一組明確 allowed paths。
- 一個可單獨運行的驗證。
- 不跨 node。
- 不修改已凍結 dependency。
- 沒有「順便重構」。

若一張 task 需要同時改 contract、migration、backend、frontend、E2E，必須再拆。

## 6. Contract Freeze

1. 先寫 Rust request/response/error DTO。
2. 生成 TypeScript。
3. 寫 serialization golden test。
4. 建立 `contracts/locks/{ID}.json`：
   - node ID。
   - contract source files。
   - SHA-256。
   - command names。
   - frozen_at。
5. `make check-contracts` 全綠後才能進入 implementation。

Contract freeze 不是永久禁止變更；它要求任何變更先回寫 node spec、tests 與 lock。已完成 dependency 的 breaking change 必須 ADR。

## 7. TDD 執行

每張 task 的最小循環：

1. 寫失敗測試或可重現 failure script。
2. 保存 red 證據：命令、失敗摘要、對應 requirement。
3. 寫最小實作。
4. 跑局部測試。
5. 跑 dependency contract tests。
6. 重構但不改行為。
7. 跑 `make ci`。
8. 更新 task status 與 evidence。

不接受「測試與實作同時完成、無法證明 red」作為 G2 一次通過證據。

## 8. Failure Loop

同一 acceptance failure 最多進行三輪：

1. 診斷：先分類 spec/test/execution。
2. 最小修復。
3. 重跑原始 oracle，不換判準。

第三輪仍失敗：

- 將 node 標為 `blocked`。
- 提交 diagnosis、已排除原因、剩餘假設。
- 由 orchestrator 決定：新增 task、改 dependency、修改 spec、回退或推翻局部設計。
- 執行 agent 不得自行弱化驗收。

## 9. 多 Agent Ownership

- Orchestrator 以 task card 的 `allowed_paths` 分配 ownership。
- 同一時間一個 implementation file 只能有一個 writer。
- Read-only 檢查不需要 ownership。
- Shared files 分三類：
  - `SPEC.md`、graph、ADR：governance owner。
  - Contract/migration order：contract owner。
  - Generated files：generator owner；其他 agent 禁止手改。
- Agent 完成時輸出 handoff：
  - 做了什麼。
  - 變更檔案。
  - 驗證證據。
  - 風險與已知限制。
  - 下一個 ready task。
  - 未解 blocker。

Agent 間不以聊天記憶作交接；只以 repository artifacts 交接。

## 10. 程式碼變更限制

Agent 禁止：

- 寫入 workspace 源文件。
- 新增網路、遙測、帳號、AI、editor 等非目標能力。
- 引入第二套 Markdown canonicalizer。
- 在 frontend 直接讀 filesystem。
- 使用 polymorphic tag FK。
- 將 orphan 自動刪除或模糊配對。
- 修改 threshold、canonicalization 或 schema 語義而不寫 ADR。
- 為通過測試移除/放寬 oracle。
- 在 production path 使用無理由 `unwrap/expect`。
- 大型無關重命名、格式化或重構。

## 11. Verification

Node 進入 `verifying` 後，由與主要實作者不同的 reviewer 或獨立 agent 執行：

1. 規格軸：逐條 requirement/BDD 對證據。
2. 架構軸：dependency boundary、資料一致性、concurrency、安全。
3. 對抗軸：錯誤輸入、事件風暴、race、ambiguous candidate、failure injection。
4. 回歸軸：dependency tests 與 `make ci`。
5. Dogfood/性能軸：必要的真實資料 gate。

Verification report 必須列出完整命令與結果，不接受「看起來可用」。

## 12. 完成與指標

通過 verification 後：

- Node status 改 `done`。
- 追加 `docs/metrics/node-outcomes.jsonl`。
- `first_pass` 按 `SPEC.md` 定義記錄。
- 若返工，填 top-level category：
  - `specification`
  - `test`
  - `execution`
- 更新 graph 狀態。
- 評估是否解鎖 downstream node。
- 若完成 milestone 最後節點，執行 dogfood gate；未通過不得開下一 milestone。
