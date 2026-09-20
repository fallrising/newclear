# End-to-End Execution Playbook

狀態：Execution-ready v0.2

## 1. Goal

從空白環境建立 private GitHub repository，在同一個受監督的 orchestration run 中依序完成 Phase 0–7。每個 phase 都要有本地 deterministic evidence、可恢復的 Git commit、GitHub branch checkpoint 與 draft PR 更新。

「一次開發完」表示 orchestrator 在 phase gate 通過後自行繼續，不要求人類重複下 prompt；不表示單一 agent、單一超大 patch、忽略失敗或自動 merge/deploy。

## 2. Fixed bootstrap inputs

本次初始建置使用：

| Input | Value |
|---|---|
| Parent workspace | `<workspace-root>` |
| Target repository | `<monorepo-root>/platform/ice-maker` |
| SDD source pack | `<knowledge-pipeline-sdd-checkout>` |
| GitHub repository | `fallrising/ice-maker` |
| Visibility | private |
| Default branch | `main` |
| Integration branch | `build/full-sdd` |
| Merge policy | final human approval; no automatic merge |

如果 target path 非空、remote 已存在、GitHub owner 不符或 source pack 有未預期變更，停止 bootstrap 並回報；不可覆寫、刪除或接管既有資料。

## 3. Preflight

開始寫入前記錄實際輸出：

1. `gh auth status` 與 authenticated login；不得輸出 token。
2. Remote name availability 與建立 private repository 的權限。
3. Git、language runtime、container runtime、OCR/PDF/build tools 的版本。
4. 上層 `AGENTS.md` 列出的每個 worker CLI：availability、version、model、auth 與 non-interactive mode。
5. VPS、object storage、provider credential 是否存在；不存在就列為 external gate，不讀取 scope 外 secret。
6. Target、worktree 與 cache path 的可寫性及剩餘空間。

`doctor` 結果寫入不含 secret 的 `docs/execution/preflight.md`。缺少非必要 provider 可依 escalation route 改派；缺少會改變安全邊界或唯一可行實作者時才 blocking。

## 4. Safe repository bootstrap

1. 由 GitHub 建立 private `fallrising/ice-maker`，用最小 README seed `main`，避免 agent 直接 push 初始內容到 `main`。
2. Clone 到 `<monorepo-root>/platform/ice-maker`；clone 本身完成 Git 初始化。
3. 從 `origin/main` 建立 `build/full-sdd`。
4. 原樣複製 SDD pack 到 `docs/sdd/`，來源目錄保持不變；以逐檔 hash 或 `diff` 驗證。
5. Target root `AGENTS.md` 同時承載上層多模型 team protocol 與本 pack 的 product-specific rules。不可因合併規則而刪除 security/knowledge constraints。
6. 建立 `.team/PLAN.md`、第一批 task files、bootstrap spec 與最小 repository structure；不要先建立大量沒有 consumer 的抽象或空 scaffold。
7. Push `build/full-sdd`，建立 draft PR 指向 `main`。後續 phase 更新同一個 PR。

Bootstrap 不安裝來源不明 script、不提交 credential、不複製 raw 私密資料，也不修改 parent workspace 的原始文件。

Phase 0–2 需要的 `CODEOWNERS`、`.github/workflows/**` 與 `orchestration/policies/**` 是 protected paths。只有在人類原樣送出 `08-MASTER-BUILD-PROMPT.md`、對應 approved spec/task 明列 allowlist，而且變更不降低安全控制時，才視為本次建置的明確授權；其他 protected-path 修改仍然禁止。

## 5. Team execution model

當前 interactive strong Codex 是 ORCHESTRATOR，負責：

- `.team/PLAN.md`、spec/phase dependency、task prompt 與 ownership。
- 依上層 routing table 選最低成本且足以可靠完成任務的 worker。
- 建立獨立 branch/worktree；避免同檔案、schema、API 與 migration 並行修改。
- 讀取每份 report 和實際 diff，自行重跑 verification。
- 決定 `ACCEPT`、`REWORK`、`REASSIGN`；一次 rework 仍失敗才依 policy 升級。
- 整合已接受 commit、執行 phase gate、push checkpoint、更新 draft PR。

每個 worker task 約五個檔案或三十分鐘，必須列出 goal、why、inputs、allowed/forbidden paths、definition of done、verification、tool/time budget，以及是否允許 commit。Worker 不直接 push、開 PR、修改 integration branch 或詢問人類。

## 6. Phase loop

對 Phase 0–7 逐一執行：

1. 讀 phase deliverables、acceptance、相關 spec/ADR 與前一 phase verification。
2. 把 phase 拆成 dependency-aware tasks；先處理未知與高風險 boundary。
3. 依 Red–Green–Refactor 完成最小 vertical slices；只平行執行互不重疊 task。
4. 每個 report 由 orchestrator review diff 並重跑指定命令，之後才整合。
5. 執行 phase 全量 gate並更新 `verification.md`，逐條標記 `pass`、`fail`、`not-tested`。
6. 判定 `PASS`、`CODE_COMPLETE_EXTERNAL_PENDING` 或 `BLOCKED`。
7. 對可交付狀態建立 phase checkpoint commit，push `build/full-sdd`，更新 draft PR。
8. `PASS` 自動進入下一 phase；external pending 只繼續不依賴缺口的工作；blocked 停止依賴鏈。

Phase checkpoint commit 使用可搜尋格式，例如：

```text
phase(0): establish decisions and security contracts
phase(1): add deterministic SDD lifecycle
```

Task commit 必須引用 spec id 與 task id。Phase push 前 integration branch 不得含未追蹤的必要檔案、失敗測試或尚未接受的 patch。

## 7. Local-first defaults

為避免在缺少 production infrastructure 時阻塞所有程式開發，採用以下可逆預設，並在 Phase 0 以 ADR 確認或修正：

- Python CLI，優先標準函式庫與現有工具；新增 production dependency 前記錄必要性、license 與供應鏈風險。
- SQLite WAL 作為本地 ledger；以 interface 隔離未來 PostgreSQL。
- 本地 filesystem/object-store fixture 作為開發 storage；production object storage 保留 adapter boundary。
- 使用合成、無敏感資訊的文字 PDF、掃描 PDF 與 knowledge notes 作端到端 fixture。
- Markdown/HTML 是 publication MVP；EPUB/PDF 只有在不引入不必要依賴時加入。
- Container、runner、OIDC、VPS 與 egress policy 必須提供配置、測試與 runbook；沒有真實基礎設施時標記 operational evidence pending。

可逆預設不能取代 security requirement。任何可能把 confidential/restricted data 傳給第三方的決定都需要人類明確批准。

## 8. GitHub checkpoint evidence

Draft PR description 維護下列表格：

| Phase | Status | Commit | Verification | External gates |
|---|---|---|---|---|
| 0 | pending | — | — | — |
| 1 | pending | — | — | — |
| 2 | pending | — | — | — |
| 3 | pending | — | — | — |
| 4 | pending | — | — | — |
| 5 | pending | — | — | — |
| 6 | pending | — | — | — |
| 7 | pending | — | — | — |

每次 push 後確認 remote SHA 等於本地 phase checkpoint。PR evidence 連回 repository 內的 spec、ADR、verification 與 runbook，不把完整 prompt、chain-of-thought、secret 或敏感 raw artifact 貼入 GitHub。

## 9. Recovery and resume

中斷後以 remote integration branch、`.team/PLAN.md`、task reports、phase verification 與 ledger 恢復：

1. Fetch remote，確認本地 HEAD、remote SHA 與最後一個 accepted phase。
2. 檢查未整合 worker branches/worktrees；不要自動刪除或重跑 side effect。
3. 以 `task_id + input_commit + spec_hash` 判斷是否安全 resume。
4. 過期 credential 重新取得；不從 log/cache 恢復 secret。
5. 從第一個未完成 acceptance 繼續，而不是重做整個 phase。

## 10. Final gate

所有 phase 的本地工作完成後：

1. 執行格式、lint、static analysis、全量 tests、build/package、schema/migration、secret/SAST/dependency/license scan與可用的端到端 smoke test。
2. 從乾淨 checkout 重建 publication，確認 source commit SHA 與 provenance。
3. 更新所有 verification、README、ADR、runbook、acceptance mapping 與 `.team/PLAN.md`。
4. 確認 source SDD pack 未被修改，remote integration branch 已同步。
5. 將 draft PR 改為 ready for review；不得自動 merge 或 deploy。

最終狀態必須明確區分：

- `DEVELOPMENT_COMPLETE`：所有程式與本地 gate 完成，PR 可審查。
- `PRODUCTION_READY`：此外還完成真實 runner/VPS、credential、backup/restore、rotation、egress 與 compromise drill。
- `PARTIAL` 或 `BLOCKED`：列出最後 checkpoint、缺口、影響與安全恢復方式。

沒有外部基礎設施證據時，最多只能宣稱 `DEVELOPMENT_COMPLETE`。
