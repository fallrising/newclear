# Ojbquay 技術任務板

## T-0368 — 主線 SDD 提案

原需求 T-0368，現屬 T-0374；[SDD](../../SDD.md) PR472／PR477 已批准。以下是原 AC 任務；todo 不代表本輪已開始實作。既有 #445 未提交候選保留。
每項實作前先補固定 AC 名稱的 executable case。task 預期 30 分鐘；長項另拆 bounded slice，不擴張產品範圍。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OJB-SDD-01 | 資源／配置真流程與五秒觀測 | AC-01 | todo | — | — | — |
| OJB-SDD-02 | producer→sink 同來源證據 | AC-02 | todo | — | — | — |
| OJB-SDD-03 | 合入既有 Go descriptor 候選後補跨語言驗證 | AC-03 | todo | — | — | — |
| OJB-SDD-04 | durable delay／retry／DLQ 故障與回歸 | AC-04 | todo | — | — | — |
| OJB-SDD-05 | 延續 #445 strict retry 根因修復，不改 oracle | AC-05 | todo | — | — | — |
| OJB-SDD-06 | producer 拒絕邊界固定 AC tests | AC-06 | todo | — | — | — |
| OJB-SDD-07 | LKG 控制面中斷 fixture | AC-07 | todo | — | — | — |
| OJB-SDD-08 | pipeline／ordered 回歸與 broker 退出診斷 | AC-08 | todo | — | — | — |
| OJB-SDD-09 | classic group reset 閘門；runtime lifecycle／啟動與 console reset gate 見 [ac09-runtime-slice](../test-reports/ac09-runtime-slice.md)；下一切片 PG fence 檢查／使用缺口改 DB lease，其後 整 group／preview／真雙 runtime | AC-09 | in_progress | 2026-10-22 | — | 2026-10-22 |
| OJB-SDD-10 | 既有 console 主線／雙 viewport evidence | AC-10 | todo | — | — | — |
| OJB-SDD-11 | 最終同版本真 Compose／核心流程資格 | AC-11 | todo | — | — | — |


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

## T-0374 — 規格與程式對照整理

Owner 直接要求整理既有文件並對照代碼。範圍為文件導航、AC 對照、靜態差異與證據；不改產品 AC 或 runtime。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OJB-DOC-01 | [規格／程式／測試對照](../specification-map.md)、入口同步、獨立審查與必要驗證 | AC-01–11（映射，非重新驗收） | done | 2026-10-22T16:17:34Z | 2026-10-22T16:58:40Z | 2026-10-22T17:00:53Z |

新發現追蹤 D-07 SDK parity、D-08 ack command queue／deadline；以及既有 D-01 retry、D-02 reset 缺口。均保留待後續選定修復範圍，未默默擴張本輪。

完成紀錄：文件 [PR492](https://github.com/fallrising/newclear/pull/492) 已合併為 `9d94c4ff8c69d7b914d6956220fdbee08a6c34a4`；已審查 head `be021f3c` 的 java／console-web／deployment-models 與 project contracts CI 全部 SUCCESS，無未解 review thread。原獨立審查的來源歸屬問題已修正並核對，原 PARTIAL／失敗與未跑產品驗收仍保留。

Owner 要求更新 GitLab；[既有 mirror run 39818611399](https://github.com/fallrising/newclear/actions/runs/39818611399) 實際推送並回讀 GitLab main，2026-10-22T16:58:52Z 兩端 SHA 均為 `9d94c4ff8c69d7b914d6956220fdbee08a6c34a4`。本列只完成文件整理與發布，不代表產品 AC-05／AC-09 通過；T-0374 保持 in_progress，沒有新 usable tag。
