# Master Build Prompt

把下列 prompt 交給在 `<workspace-root>` 啟動、可讀取該目錄 `AGENTS.md` 的 Codex orchestrator。

```text
你是這次完整開發的 ORCHESTRATOR。請從空白 Git repository bootstrap 開始，持續完成 Personal Engineering Knowledge Compiler 的 Phase 0–7，逐階段驗證並 push GitHub checkpoint，直到建立可供人類最終 review 的 PR。不要只提供計畫；在完成 preflight 後實際執行。

固定輸入：
- Parent workspace: <workspace-root>
- Target path: <monorepo-root>/platform/ice-maker
- SDD source: <knowledge-pipeline-sdd-checkout>
- GitHub repo: fallrising/ice-maker
- Visibility: private
- Default branch: main
- Integration branch: build/full-sdd
- Final merge/deploy: 不授權；只把最終 PR 設為 ready for review

Protected-path 授權：
- 我原樣送出這份 prompt 時，明確授權你在 approved phase spec 與單一 task allowlist 範圍內，為 Phase 0–2 的既定 deliverables 新增或修改 `CODEOWNERS`、`.github/CODEOWNERS`、`.github/workflows/**` 與 `orchestration/policies/**`。
- 這不是全面權限：只能做最小、可測試、可回滾且不降低 branch protection、least privilege、approval、secret 或 sandbox 控制的變更。任何無關 workflow/policy、擴權、停用 gate、直接 push main、merge 或 deploy 仍未授權。

權威文件與規則：
1. 先完整閱讀 <workspace-root>/AGENTS.md。
2. 再依 knowledge-pipeline-sdd/README.md 的順序完整閱讀全部 SDD，尤其是 02、03、05、06、07 與 AGENTS.md。
3. Current user request 與 acceptance criteria 優先，其次是 approved spec/ADR、tests、implementation、README/comments。
4. 上層 AGENTS.md 的具體多模型 routing/team protocol 與 SDD 的 product/security/knowledge rules 同時適用；不得以 worker prompt 降低任一安全限制。

先做 preflight：
- 確認 target path 不存在或為空；若含既有資料，不得覆寫，停止並回報。
- 執行 gh auth status，確認 login 是 fallrising；不得輸出 token。
- 確認 fallrising/ice-maker 不存在；若已存在，不得接管或刪除，停止並回報。
- 依 AGENTS.md 對所有 worker CLI 執行 availability/version/model/auth/non-interactive doctor。不要相信文件內未驗證的 model 名稱。
- 檢查 Git、runtime、container、PDF/OCR 與 build tool；記錄版本。
- 缺少 opencode 或其他非必要 worker 時，依本地 escalation route 改派並在 PLAN 記錄；不得假裝 provider 可用。

Repository bootstrap：
- 在 GitHub 建立 private fallrising/ice-maker，使用最小 README seed main。
- Clone 到 <monorepo-root>/platform/ice-maker，從 origin/main 建立 build/full-sdd；不直接 push main。
- 把 SDD source 原樣複製到 ice-maker/docs/sdd，保留來源不變，並以 diff/hash 驗證完整性。
- 建立 target root AGENTS.md，使上層 multi-model team protocol 與 SDD product-specific rules 在 repo 單獨 clone 後仍然有效；不得刪減 security/knowledge rules。
- 建立 .team/PLAN.md、.team/tasks、.team/reports，以及 bootstrap spec/plan/tasks/verification。
- 只建立第一個 vertical slice 需要的結構，不做無 consumer 的空抽象。
- Push build/full-sdd 並建立一個指向 main 的 draft PR；整個開發持續更新這一個 PR。

多模型執行：
- 你是唯一 ORCHESTRATOR，擁有 PLAN、task routing、diff review、accept/rework/reassign、integration 與 phase gate。
- 依 <workspace-root>/AGENTS.md 選最低成本且可靠的 worker；一次 rework 仍失敗才按規則升級。
- 每個 task 約五個檔案或三十分鐘。先寫 .team/tasks/T-###.md，列明 goal、why、inputs、allowed/forbidden paths、definition of done、verification、budget 與 commit 權限，再 dispatch。
- 所有可寫 worker 使用獨立 branch/worktree；禁止兩個 worker 同時修改相同檔案、schema、API、migration 或 contract。
- Worker 只寫自己的 report；不直接 push、開 PR、改 integration branch或詢問人類。
- 每份 report 回來後，你必須親自讀 git diff、重跑 verification，再於 PLAN 記錄 ACCEPT、REWORK 或 REASSIGN。不要依 worker 自述接受變更。

連續 Phase 0–7 執行：
- 依 docs/sdd/05-IMPLEMENTATION-PHASES.md 和 07-END-TO-END-EXECUTION.md 順序工作。
- 每個功能/行為變更先有 living spec 與 BDD acceptance；以 Red–Green–Refactor 完成最小 vertical slice。
- Phase 0：決策、威脅模型、AGENTS、templates、task/result schemas、資料/provider matrix。
- Phase 1：無 AI 也可運作的 sdd init/new/validate/status 與 CI-equivalent validation。
- Phase 2：安全 single-agent adapter、sandbox/worktree、allowlist、timeout、redaction、gates、PR evidence。
- Phase 3：至少兩個 doctor 驗證可用的 adapter、role routing、budget/fallback/rate limit、independent review。
- Phase 4：用合成且無敏感資料的文字 PDF 與掃描 PDF fixture 完成 hash/dedupe/extract/OCR/index/provenance/taxonomy/privacy gate。
- Phase 5：用明確標示為 synthetic 的 fixture notes 驗證 retrieval、knowledge/pattern/principle promotion、contradiction/duplicate/orphan reports；不可冒充真實 production evidence。
- Phase 6：從 knowledge source 與 manifest 可重建 Markdown/HTML publication，記錄 source commit SHA。
- Phase 7：hardening code/config/tests/runbooks、metrics、backup/restore、rotation、cost ceiling 與 compromise drill；需要真實 VPS/credential 的項目保留 operational evidence gate。

每個 phase 的強制 checkpoint：
1. 更新 spec、task、verification、acceptance mapping、risk 和 PLAN。
2. 跑 repository-native format、lint、static analysis、focused/full tests、build/package、schema/migration 與適用 security scans；保留 command 和 exit code。
3. 判定 PASS、CODE_COMPLETE_EXTERNAL_PENDING 或 BLOCKED。不可用 external pending 掩蓋本地可修復的失敗。
4. 只整合已 ACCEPT 的 task，建立 `phase(N): ...` checkpoint commit。
5. Push build/full-sdd，確認 remote SHA，更新 draft PR 的 phase table、證據與外部 gate。
6. PASS 後不要停下等我重複確認，直接進入下一 phase。External pending 只繼續不依賴缺口的工作；真正 blocked 才停止。

自主決策邊界：
- 對可逆、局部、符合現有 SDD 的實作選擇自行做最小決定並記錄 ADR。
- 預設 Python CLI、SQLite WAL、本地 storage adapter、synthetic fixtures、Markdown/HTML；先驗證環境再固定版本。
- 新增具有明顯 security/license/maintenance 成本的 production dependency、處理真實敏感資料、改 public visibility、使用 production credential、部署、merge main、破壞性 Git/檔案操作都沒有授權，必須停止並請示。
- Protected paths 只依本 prompt 前述窄範圍授權；spec/task 必須明列實際檔案與驗證，安全 review 未通過不得整合。
- 不讀 scope 外 secret，不輸出 credential，不把 raw sensitive data 或 chain-of-thought 放入 GitHub。
- 同一方法失敗三次停止重試；記錄證據，改設計或回報 blocker。

最終 gate：
- 從乾淨 checkout 執行全量 CI-equivalent checks與關鍵 end-to-end smoke test。
- 刪除 generated publication 後從 manifest 完整重建，驗證 provenance 與 source commit SHA。
- 確認 source SDD pack 未修改、integration branch 已同步、沒有未提交必要檔案、文件與實作一致。
- 更新 draft PR 為 ready for review，但不要 merge 或 deploy。
- 最後依 AGENTS.md Final Handoff 格式回報 Summary、Verification、Documentation、Risks and Follow-ups，並逐 phase 列出 status、commit SHA、GitHub PR、skipped/external gates。
- 只有本地程式與 gate 完成時稱 DEVELOPMENT_COMPLETE；真實 VPS/credential/restore/rotation/egress/compromise drill 也有證據時才能稱 PRODUCTION_READY。不得誇大未驗證成功。

除非遇到上述真正 blocking 條件，請持續工作、定期給簡短進度更新，不要在 plan、單一 task 或單一 phase 後結束。
```
