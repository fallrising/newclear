# Ojbquay 技術任務板

## T-0368 — 主線 SDD 提案

需求 T-0368；[SDD](../../SDD.md) 待 owner 同意。以下是 AC 對應草案，尚未依新 SDD 開工或關閉；既有 #445 未提交候選保留。
每項實作前先補固定 AC 名稱的 executable case。task 預期 30 分鐘；長項另拆 bounded slice，不擴張產品範圍。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OJB-SDD-01 | 等 owner：資源／配置真流程與五秒觀測 | AC-01 | todo | — | — | — |
| OJB-SDD-02 | 等 owner：producer→sink 同來源證據 | AC-02 | todo | — | — | — |
| OJB-SDD-03 | 等 owner：合入既有 Go descriptor 候選後補跨語言驗證 | AC-03 | todo | — | — | — |
| OJB-SDD-04 | 等 owner：durable delay／retry／DLQ 故障與回歸 | AC-04 | todo | — | — | — |
| OJB-SDD-05 | 等 owner：延續 #445 strict retry 根因修復，不改 oracle | AC-05 | todo | — | — | — |
| OJB-SDD-06 | 等 owner：producer 拒絕邊界固定 AC tests | AC-06 | todo | — | — | — |
| OJB-SDD-07 | 等 owner：LKG 控制面中斷 fixture | AC-07 | todo | — | — | — |
| OJB-SDD-08 | 等 owner：pipeline／ordered 回歸與 broker 退出診斷 | AC-08 | todo | — | — | — |
| OJB-SDD-09 | classic group reset 閘門；runtime lifecycle／啟動與 console reset gate 見 [ac09-runtime-slice](../test-reports/ac09-runtime-slice.md)；下一切片 PG fence 檢查／使用缺口改 DB lease，其後 整 group／preview／真雙 runtime | AC-09 | in_progress | 2026-10-22 | — | 2026-10-22 |
| OJB-SDD-10 | 等 owner：既有 console 主線／雙 viewport evidence | AC-10 | todo | — | — | — |
| OJB-SDD-11 | 等 owner：最終同版本真 Compose／核心流程資格 | AC-11 | todo | — | — | — |


### 2026-10-22 C1b takeover (desk T-0374, formerly T-0368)

PR #485 durable lease: initial CI passed; T486 review found failed INSERT leaked a pooled advisory
lock. Root reproduced real-PG RED (expected0/actual1), fixed acquisition cleanup and added abort
fallback coverage. Console46/0, build, deploymodels,15 contracttests and41 contracts PASS; bounded
correction review ACCEPT. Final-head CI/merge/readback pending. Evidence: `.team/evidence/c1b-takeover/verification.json`.
Full AC09 remains partial: uncertain Kafka completion and expired/stalled owner safety must be
resolved before C2 whole-group, C3 preview/confirm and C4 real dual-runtime qualification. AC05
still lacks qualifying execution under approved #477; usable_tag none.

### 2026-10-22 uncertain reset outcome (desk T-0374)

OJB-SDD-09 remains in_progress, last_activity2026-10-22T16:18Z. Bounded next slice: [durable quarantine design](../reset-outcome-safety.md), with paused subscription retained after unverified Kafka alter and token/expiry validation before submission. Console initial GREEN; adapter boundary and stale-token regressions plus full build/review pending. No AC09 completion claim, no recovery automation, no usable tag.

Validation2026-10-22T16:20Z: final `./gradlew build --no-daemon --no-parallel` PASS (console 51/0/0/0 executed; 145 current JUnit cases including cached modules, 21 executed tasks/14 cache/9 up-to-date). Deploy models,15 contract tests,41 project contracts and diff check PASS. Initial RED was an unhandled timeout ServletException before the state assertion, preserved as failure; final integration test verifies pause/infinite row/rejected resume and reacquisition. Independent review and final-head CI remain required. No full AC09 or real delayed-broker acceptance.
