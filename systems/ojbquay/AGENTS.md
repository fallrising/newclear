# AGENTS.md

## Scope

These instructions apply to the entire `ojbquay` repository.

## Product Baseline

- The accepted product baseline is `docs/product-spec.md`.
- Architectural decisions are recorded in `docs/adr/`.
- External contracts live under `proto/` and evolve additively.
- Java packages use `dev.ojbk.*` and Protobuf packages use `ojbk.v1` as the
  native API namespace for the `ojbquay` product.

## Engineering Rules

- Compile and run Java code on the Java 25 LTS baseline.
- Use Gradle Kotlin DSL and the checked-in Gradle wrapper.
- Keep data-plane modules free of Spring.
- Use immutable configuration snapshots and atomic replacement.
- Keep queues, caches, batches, retries, and executors bounded.
- Never log message payloads, credentials, or resource tokens.
- Use stable application error codes; do not expose broker exceptions.
- Treat PostgreSQL as metadata SSOT and Kafka as the v1 broker/config bus.

## Verification

- Follow Red-Green-Refactor for behavior changes.
- Prefer unit tests, then contract tests, then Testcontainers integration tests, then end-to-end tests.
- Run the narrowest relevant check while developing and `./gradlew build` before each milestone commit.
- A milestone commit must update its task evidence in `docs/execution-plan.md`.

## Git

- Use Conventional Commits.
- Commit and push only after the milestone acceptance gate passes.
- Do not mix work from different milestones in one commit.

## 主線與驗收文件先行

- 接手前先讀 [SUCCESS.md](SUCCESS.md)、相關規格與最近驗證紀錄，核對目前主線及缺口。
- 實作前先更新 SUCCESS 的本次目標、範圍、AC 與驗證計畫；不得為了完成而縮小已承諾主線。
- 收尾逐項記錄實際命令、結果、來源版本與未通過原因，同步 README 必要入口及項目進度；未跑不可寫通過。
- 主線全部驗收、必要 CI／審查通過並合併後，按 repo 共用規範建立 annotated `usable/<slug>/vX.Y.Z`，回讀遠端並更新索引。現行 owner 授權適用；本規則不授權部署或付費服務。
- 參考／封存項目保留其結束條件，不以新增文件當作可執行版本，也不因此恢復開發。
