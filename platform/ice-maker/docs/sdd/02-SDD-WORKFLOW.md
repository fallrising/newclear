# SDD Workflow and Contracts

## 1. 每個功能的四份產物

```text
specs/active/<slug>/
├── spec.md          # Why / What / acceptance criteria
├── plan.md          # How / components / migration / risk
├── tasks.md         # Small executable units
└── verification.md  # Evidence and final assessment
```

## 2. `spec.md` 必填欄位

```yaml
---
id: SDD-0001
title: Example feature
status: draft
owner: human
risk: low            # low | medium | high | critical
data_class: internal # public | internal | confidential | restricted
budget_usd: 5
allowed_paths:
  - src/**
  - tests/**
forbidden_paths:
  - .github/workflows/**
  - orchestration/policies/**
---
```

正文必須包含：Context、Goals、Non-goals、User stories、Functional requirements、Non-functional requirements、Acceptance criteria、Failure modes、Open questions。

## 3. `plan.md`

必須將 requirement 映射到元件與驗證：

| Requirement | Change | Test | Rollback |
|---|---|---|---|
| FR-1 | module/path | test name | revert commit/feature flag |

高風險 plan 必須先由 `architect_rare` 或人工 review；planner 不可直接進入 implementation。

## 4. `tasks.md`

每個 task 要在一次 bounded agent run 中完成：

```markdown
- [ ] T-001 Add parser interface
  - Depends on: none
  - Allowed paths: src/parser/**, tests/parser/**
  - Acceptance: unit tests pass; malformed input rejected
  - Suggested role: builder_economy
  - Max attempts: 2
```

若 task 超過約 30–60 分鐘、涉及多個 ownership boundary 或驗收無法一句話說清，應再拆分。

## 5. Unified Task Contract

Orchestrator 傳給所有 adapter 的輸入：

```json
{
  "task_id": "SDD-0001-T001",
  "repo": "owner/repo",
  "base_sha": "immutable-sha",
  "spec_path": "specs/active/example/spec.md",
  "task_path": "specs/active/example/tasks.md#T-001",
  "role": "builder_primary",
  "allowed_paths": ["src/parser/**", "tests/parser/**"],
  "network_policy": "deny-by-default",
  "max_seconds": 1800,
  "max_cost_usd": 3,
  "required_commands": ["make lint", "make test"]
}
```

Adapter 必須輸出機器可讀結果：

```json
{
  "status": "completed",
  "summary": "...",
  "changed_files": ["..."],
  "commands_run": [{"command":"make test","exit_code":0}],
  "tests": {"passed": 42, "failed": 0},
  "risks": [],
  "open_questions": [],
  "usage": {"provider":"...", "model":"...", "estimated_cost_usd":1.2}
}
```

## 6. Verification rules

- 不接受只有「agent 說完成」而沒有 command output 的任務。
- 變更檔案必須落在 allowlist；symlink 與 rename 也要檢查 resolved path。
- 驗收條件逐條標示 pass/fail/not-tested。
- reviewer agent 只能評論或產生獨立 patch，不直接覆蓋 builder worktree。
- 規格變更需重新核准；不得在 implementation 中悄悄改 acceptance criteria。

## 7. PR template

PR 必須包含：Spec、Task、Summary、Files changed、Acceptance evidence、Security scan、Cost/usage、Known limitations、Human checklist。AI 生成的內容要標示 provider/model alias 與執行時間，但不要提交完整 chain-of-thought；只存簡潔決策摘要與可重現證據。

## 8. Phase delivery contract

完整建置使用一條長期 integration branch，例如 `build/full-sdd`，並建立一個 draft PR 指向 `main`。各 worker 仍在獨立 task branch/worktree 工作；orchestrator 驗收後才把 task commit 整合到 integration branch。

每個 phase 必須依序完成：

1. 更新該 phase 的 spec、task 狀態、acceptance mapping 與 `verification.md`。
2. 執行 repository-native format、lint、static analysis、tests、build 與適用的 security gate。
3. 確認 changed paths、secret scan、working tree 與 phase rollback point。
4. 產生單一 phase checkpoint commit；不得把失敗或未審查的 worker patch 納入。
5. Push integration branch，更新同一個 draft PR 的 phase 狀態與證據。
6. Gate 為 `PASS` 時自動進入下一 phase，不等待重複的人類確認。

Phase gate 只有三種狀態：

- `PASS`：deliverables 與 acceptance 全部有證據，可繼續。
- `CODE_COMPLETE_EXTERNAL_PENDING`：程式、測試與本地模擬已完成，唯一缺口是預先識別的 VPS、credential、付費服務或人工權限。可繼續不依賴該外部資源的工作，但不得把 phase 或最終系統宣稱為 production-ready。
- `BLOCKED`：規格衝突、安全風險、必要測試失敗或缺少會改變設計的決策。停止後續依賴工作並回報。

禁止以 `CODE_COMPLETE_EXTERNAL_PENDING` 包裝可由本地修復的失敗、缺少測試、未完成程式或未處理的 critical risk。

## 9. GitHub checkpoint rules

- 遠端 repository 預設 private；除非人類明確改變資料分類與可見性決策。
- 不直接 push `main`，不 force push，不自動 merge 最終 PR。
- 每個 phase 至少 push 一次已通過 gate 的 integration branch checkpoint。
- Draft PR 是連續執行的共享狀態頁；逐 phase 補上 commit SHA、commands、exit codes、acceptance、風險與外部待驗證事項。
- Push 失敗不等於測試失敗。保留本地 commit，診斷 auth/network/remote 狀態後重試；不可重新產生或遺失已驗證內容。
- 最終 PR 只有在所有可本地驗證的 phase 完成、全量 gate 通過且文件一致時才改為 ready for review。
