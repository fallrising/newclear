# Edge Ops — 後續 session 固定入口

本文件是啟動協定，不保存當前 milestone，不是自動部署或執行授權。

## Repository 與完整閱讀

Repository：`https://github.com/fallrising/newclear`。

Canonical component：`platform/edge-ops/`。

HTTP 入口：`https://github.com/fallrising/newclear/blob/main/platform/edge-ops/DEVELOPMENT_PROMPT.md`（只在本設計 PR 合併後存在於 main；合併前使用明確 PR branch/ref）。

使用可用的已授權 GitHub connector，或在具已配置權限的環境透過 `git@github.com:fallrising/newclear.git` 讀取。不要為滿足讀取去輸出或轉存 private key/token。工具無法 SSH 時應說明，不假稱已 clone。

先讀根 README、PORTFOLIO、docs/taxonomy.md、docs/portfolio-doc-tiers.md、docs/specs/monorepo-ci.md，再完整讀以下相對 repository 的固定路徑：

```text
platform/edge-ops/AGENTS.md
platform/edge-ops/SDD.md
platform/edge-ops/docs/STATUS.md
platform/edge-ops/docs/SOURCES.md
platform/edge-ops/docs/sdd/README.md
platform/edge-ops/docs/sdd/01-frontend.md
platform/edge-ops/docs/sdd/02-backend.md
platform/edge-ops/docs/sdd/03-agent.md
platform/edge-ops/docs/sdd/04-bootstrap-and-images.md
platform/edge-ops/docs/sdd/05-contracts-and-security.md
platform/edge-ops/docs/sdd/06-delivery-and-acceptance.md
platform/edge-ops/docs/sdd/07-capacity-and-operations.md
```

必讀文件不能只看搜尋片段或根摘要。若結果截斷，讀到檔尾；記錄實際 ref、缺漏與對任務的影響。與相鄰專案整合前，再讀實際 adapter 所涉及的契約，不從 README 推論不存在的接口。

## 核對與執行

核對 base commit、現有 branch／open PR、工作樹和 docs/STATUS，找最早尚未驗收的 milestone。先確認本次使用者是否要求實作；若只有設計／討論，不自動開發。

有實作授權後，從最小且可離線驗證的切片開始；先契約後前端／後端／Agent 平行，獨立 worktree 不互改權威檔。不得重造 OneVPS host authority、OneFleet workload lifecycle 或 agent-platform LLM runtime。

回報實際修改、commit／PR、已執行 gate、未執行原因、獨立 review 狀態與下一步。docs/STATUS 是唯一進度權威。不要自動合併 PR，不執行 deployment、bootstrap、Terraform apply、sudo、reboot 或現役機器測試，除非使用者另行明確授權該環境與操作。

## 可交给下一個 session 的要求

「請完整閱讀 `fallrising/newclear` 的 `platform/edge-ops/DEVELOPMENT_PROMPT.md` 及其必讀文件，先核對實際 PR/main 與 STATUS；本次只執行我明確選定的 milestone。先通過共用契約與安全 gate，再分派前端、後端、Agent；提交可回溯 PR，不部署或操作真實主機。」
