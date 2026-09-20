# Implementation Phases

每階段都能獨立產生可用增量；完成驗收後才進下一階段。

完整建置可以在同一個 orchestration run 連續執行 Phase 0–7。這不改變逐階段 gate：每個 phase 仍需留下 verification、checkpoint commit、GitHub push 與 draft PR 更新。`PASS` 自動前進；`CODE_COMPLETE_EXTERNAL_PENDING` 只允許不依賴缺少資源的後續工作；`BLOCKED` 停止依賴鏈。詳細契約見 `07-END-TO-END-EXECUTION.md`。

## Phase 0 — Decisions and threat model

Deliverables：

- Repo 初始化、branch protection、CODEOWNERS。
- ADR：runner isolation、storage、credential、model-provider availability。
- `AGENTS.md`、spec templates、task/result JSON Schema。
- 資料分類與允許送往各 provider 的矩陣。

Acceptance：所有 open decisions 有 owner；critical risk 無未處理項；模型實際 ID 由 `doctor` 驗證。

## Phase 1 — Deterministic SDD skeleton

Deliverables：

- `sdd init/new/validate/status` CLI。
- spec/plan/tasks/verification 模板與 CI validation。
- 普通程式變更可手動建立 branch/PR。

Acceptance：無 AI 也能完成一個完整 SDD lifecycle；錯誤 schema 阻擋 PR。

## Phase 2 — Secure single-agent execution

Deliverables：

- Repo-scoped self-hosted runner。
- Disposable sandbox + isolated worktree。
- 第一個 adapter（建議 Codex 或 Cursor）。
- Path allowlist、timeout、log redaction、test gates、PR publisher。

Acceptance：agent 無法寫 main、workflow、host root 或 forbidden paths；失敗 job 不污染下一次。

## Phase 3 — Multi-provider routing

Deliverables：

- 第二與第三 adapter（OpenCode、Claude/Grok review）。
- Role alias、health check、budget、fallback、rate-limit handling。
- Sequential builder/reviewer pipeline。

Acceptance：同一 fixture 可由兩個 adapter 執行；模型不可用時按 policy fail/fallback；用量可追蹤。

## Phase 4 — Knowledge ingestion MVP

Deliverables：

- `knowledge ingest/extract/index/propose`。
- PDF text extraction、OCR、image OCR、hash dedupe。
- manifest、provenance、taxonomy validator、sensitive-data gate。

Acceptance：文字 PDF 與掃描 PDF 各一份端到端；重跑不重做 OCR；每條知識可回到頁碼。

## Phase 5 — Knowledge synthesis

Deliverables：

- Retrieval + related-note comparison。
- knowledge/pattern/principle promotion workflow。
- contradiction、duplicate、orphan link reports。
- independent critic + human promotion gate。

Acceptance：至少一組 production experience 被橫向比較並形成 pattern；無來源推論被明確標示。

## Phase 6 — Publication compiler

Deliverables：

- Book manifest、chapter assembly、cross-reference、bibliography。
- Markdown/HTML；EPUB/PDF 可後續加入。
- Reproducible build with source commit SHA。

Acceptance：刪除 generated output 後可完整重建；同一知識可被兩本書重用。

## Phase 7 — Hardening and scale

Deliverables：

- Ephemeral runners、OIDC/short-lived credentials、network egress proxy。
- OpenTelemetry/metrics、quota dashboard、backup restore drill。
- 可選 Temporal/Prefect；只有在 Actions concurrency 不足時導入。

Acceptance：runner compromise tabletop、restore drill、credential rotation、cost ceiling 測試通過。

## 建議第一個 vertical slice

不要先安裝所有 agent。先選一份無敏感資訊的 10–30 頁 PDF：

1. `sdd new knowledge-ingest-pdf`
2. 本地 extract/OCR、hash、manifest。
3. 單一 agent 產生 information note。
4. 檢索 repo、提出 knowledge patch。
5. tests/scan/pass 後建立 PR。
6. 人工 merge，再由 book manifest 組一章 Markdown。

這條 vertical slice 能最早驗證 SDD、runner、agent、知識 schema 與出版物是否真的連通。

## Full-build ordering

單次完整建置採下列 dependency-aware 順序：

1. Phase 0 固定安全、資料、provider 與開發環境決策。
2. Phase 1 建立不依賴 AI 的 deterministic control plane。
3. Phase 2 只接一個真實 adapter，先證明 sandbox、allowlist 與 PR evidence。
4. Phase 3 才增加 provider routing 與 independent review。
5. Phase 4 使用合成、無敏感資料的文字 PDF 與掃描 PDF fixture 完成 ingestion。
6. Phase 5 使用具有 provenance 的 fixture notes 驗證 synthesis；不得假裝成真實 production evidence。
7. Phase 6 從相同 fixture knowledge 重建 Markdown/HTML publication。
8. Phase 7 完成 hardening code、配置、測試與 runbook；需要真實 VPS/credential 的驗收另列 operational evidence。

每個 phase 結束時，integration branch 的狀態必須可 checkout、可重跑且不依賴 worker 的未提交檔案。後續 phase 不得修改前一 phase 的 acceptance criteria 來掩蓋 regression；如證據推翻設計，先更新 spec/ADR、重新驗證受影響 phase，再繼續。
