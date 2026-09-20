# Multi-Agent Orchestration

## 1. 不要從「多 agent」開始

MVP 先實作一個 orchestrator、兩個 adapter、單一 writer。多模型價值來自角色分離與獨立 review，不是同時呼叫越多越好。

## 2. Adapter interface

每個 adapter 實作相同介面：

```text
doctor()    -> availability, version, models, auth status
plan(task)  -> structured plan (read-only)
execute(task, workspace) -> patch + result.json
review(task, diff) -> findings.json
cancel(run_id)
```

Adapter 不應內建商業邏輯；prompt、policy、model mapping 都在 repo 配置。

## 3. 配置示例

```yaml
roles:
  planner_strong:
    adapter: cursor
    model_env: CURSOR_PLANNER_MODEL
    timeout_seconds: 1800
    max_cost_usd: 8
  architect_rare:
    adapter: claude
    model_env: CLAUDE_ARCHITECT_MODEL
    require_manual_approval: true
  critic_independent:
    adapter: xai
    model_env: XAI_REVIEW_MODEL
    read_only: true
  builder_economy:
    adapter: opencode
    model_env: OPENCODE_BUILDER_MODEL
```

實際 model ID 只放在 VPS secret/config，不提交假設值。啟動前 `orchestrator doctor` 列出 CLI 版本、可用 model、non-interactive mode 與缺少的 credential。

## 4. Routing

路由輸入：task type、risk、repo size、required modalities、budget、provider health、rate limits、資料分類。

```text
low-risk mechanical change -> builder_economy
repo-aware implementation  -> builder_primary
architecture/ambiguous      -> planner_strong, then human gate
rare hard problem           -> architect_rare
security/logic review       -> critic_independent using different provider
```

降級只能發生在同等或更高 policy tier。若指定模型不可用，預設 `fail closed`，除非 spec 明確允許 fallback aliases。

## 5. Collaboration patterns

### Sequential（預設）

Planner → Builder → Deterministic tests → Independent reviewer → Human merge。

### Parallel research

多個 read-only agent 各自分析；synthesizer 只整合報告。適合 ADR、疑難與方案比較。

### Parallel implementation

僅用於互不重疊的 task。每個 agent 有獨立 worktree/branch；禁止共享可寫目錄。Integration agent 以 cherry-pick/merge 加上全量測試整合。

### Debate

兩個 agent 提出不同設計，第三方依已公開 rubric 評估。不要讓 evaluator 同時是某方案作者。

## 6. Cost and loop controls

- 每個 task 設 max wall time、attempts、tool calls、cost。
- 同一錯誤 signature 連續兩次即停止自動 retry。
- context 使用 repo retrieval，只提供必要檔案與 diff。
- 小任務先用經濟模型；升級要附原因。
- 對 prompt、tool output 與模型回覆做 hash/cache，但 secrets 不進 cache。
- 避免 agent 互相自由對話；用 versioned JSON artifacts 傳遞。

## 7. Provider-specific notes

- Cursor、Claude Code、OpenCode 優先透過官方 CLI/Action/SDK 的非互動介面封裝。
- 若 xAI/Grok 沒有 repo-aware coding CLI，使用 API adapter 做 read-only analysis/review，避免自行模擬完整 shell agent。
- Codex 與 OpenCode 是不同執行 adapter；「Codex 使用 OpenCode API key」應拆成 credential/provider routing，而不是假設兩者原生互相嵌套。
- CLI upgrade 必須 pin version、先在 canary runner 測試，再更新 production runner image。

## 8. Local multi-model team binding

若執行目錄的上層 `AGENTS.md` 定義具體的 orchestrator、worker、CLI、model、effort 與 escalation route，該規則是本地執行 policy；本文件的 alias 與 adapter contract 是產品設計。兩者同時適用：

- local identifier（例如 `codex-cheap`）決定本次由誰執行；product alias（例如 `builder_economy`）描述任務能力與權限。
- orchestrator 在 dispatch 前執行 `doctor`，驗證 CLI、精確 model ID、auth、non-interactive mode 與 worktree path。
- 不可用的 agent 不得假裝成功或寫死替代 model；依 local escalation route 改派，並在 `.team/PLAN.md` 記錄證據。
- orchestrator 專有工作是規劃、task routing、diff review、驗證重跑、整合與 accept/rework/reassign 決策。
- worker 只讀 `AGENTS.md`、自己的 `.team/tasks/T-###.md` 與 task 明列的 inputs；只修改 allowlist paths。
- worker 使用獨立 branch/worktree。同一檔案、schema 或 contract 不平行寫入。
- worker report 寫入 `.team/reports/T-###.md`；orchestrator 不因 report 聲稱而接受，必須自行讀 diff 並重跑 verification。

建議能力映射：

| Product role | Local routing intent |
|---|---|
| `planner_strong` | current strong orchestrator；不可 dispatch 自己 |
| `builder_economy` | 可用的最低成本 routine implementation worker |
| `builder_primary` | repo-aware implementation worker |
| `critic_independent` | 與 builder 不同 provider 的 read-only reviewer |
| `architect_rare` | 僅在架構、安全或一次 rework 仍失敗時使用 |

多模型是成本與獨立性策略，不是 phase acceptance。缺少某個 provider 時，只要 policy 允許且仍有合格 builder/reviewer，可以依 route 繼續；若獨立安全 review 是 acceptance 的一部分而沒有合格 provider，phase 必須標記 `BLOCKED` 或 `CODE_COMPLETE_EXTERNAL_PENDING`，不得靜默略過。

## 9. Continuous-run coordination

完整建置開始後，orchestrator 建立並持續維護：

```text
.team/PLAN.md
.team/tasks/T-###.md
.team/reports/T-###.md
```

Task 以約五個檔案或三十分鐘為上限，必須有 allowed/forbidden paths、definition of done、verification command 與 budget。Phase 內只平行派發沒有檔案、schema、API 或 migration ownership 衝突的 task。每次 worker 回報後立即 review；phase gate 通過後 push GitHub checkpoint，再自動進入下一 phase。
