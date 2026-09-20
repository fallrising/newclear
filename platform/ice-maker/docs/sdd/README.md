# SDD Document Pack

建議閱讀順序：

1. `00-SDD-OVERVIEW.md`
2. `01-ARCHITECTURE.md`
3. `02-SDD-WORKFLOW.md`
4. `03-MULTI-AGENT-ORCHESTRATION.md`
5. `04-KNOWLEDGE-REFINERY.md`
6. `05-IMPLEMENTATION-PHASES.md`
7. `06-SECURITY-OPERATIONS.md`
8. `07-END-TO-END-EXECUTION.md`
9. `08-MASTER-BUILD-PROMPT.md`
10. `AGENTS.md`

這是 execution-ready v0.2。架構與 provider 維持可替換，但已補齊從 repository bootstrap、Phase 0–7、逐階段 GitHub checkpoint 到最終 PR 的連續執行契約。

`08-MASTER-BUILD-PROMPT.md` 可直接交給位於本目錄、受上層 `AGENTS.md` 多模型團隊規則約束的 orchestrator。一次執行代表同一個 orchestration run 持續完成所有可驗證階段；不是單一 agent、單一 commit，也不允許跳過測試、安全 gate 或人類 merge gate。
