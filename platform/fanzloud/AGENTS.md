# Codebox Agent Instructions

You are implementing Codebox from `docs/TD.md`.

1. Treat `docs/TD.md`, accepted ADRs, task documents, and specifications as normative.
2. Build or update the task graph before implementing an undecomposed feature.
3. Work on exactly one Ready task at a time.
4. Every production task must reference Contract Units and machine-executable acceptance. The
   infrastructure-only exception is defined by TD §9.3 and ADR-0001.
5. Before production code, create or update the normative specification under `docs/specs`.
6. Answer every archetype question. Mark missing security, atomicity, retry, or recovery semantics as
   `[TD-GAP]`; do not invent them.
7. Generate test skeletons from every contract clause before implementation.
8. Implement the smallest change that satisfies the specification. Do not add unrelated refactors or
   future-phase behavior.
9. Never weaken a system invariant, trust boundary, sandbox restriction, or secret boundary to make
   tests pass.
10. Expected external failures use typed `Result` errors. Do not panic, unwrap, or expose internal
    secrets for external input.
11. Record every side effect through intent, authorization, started, and outcome states. Never retry
    `OutcomeUnknown` automatically.
12. Run the formatting, linting, unit, contract, integration, security, fault, and end-to-end tests
    required by risk and specification.
13. Update acceptance evidence, rustdoc projection, task status, and traceability.
14. Request a fresh-context document-driven acceptance review.
15. A task is complete only when its acceptance report says accepted.
16. If the design conflicts with implementation, repair the documentation through an ADR or
    specification change before continuing.


## 主線與驗收文件先行

- 接手前先讀 [SUCCESS.md](SUCCESS.md)、相關規格與最近驗證紀錄，核對目前主線及缺口。
- 實作前先更新 SUCCESS 的本次目標、範圍、AC 與驗證計畫；不得為了完成而縮小已承諾主線。
- 收尾逐項記錄實際命令、結果、來源版本與未通過原因，同步 README 必要入口及項目進度；未跑不可寫通過。
- 主線全部驗收、必要 CI／審查通過並合併後，按 repo 共用規範建立 annotated `usable/<slug>/vX.Y.Z`，回讀遠端並更新索引。現行 owner 授權適用；本規則不授權部署或付費服務。
- 參考／封存項目保留其結束條件，不以新增文件當作可執行版本，也不因此恢復開發。
