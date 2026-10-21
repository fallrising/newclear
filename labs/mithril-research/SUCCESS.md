---
project: labs/mithril-research
purpose: 以固定 Mithril 來源驗證 Redis Cluster 代理的適配與操作邊界
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# mithril-research 成功契約

## 主線與範圍

[SDD](docs/SDD.md) 保留MR-R01–09與C01–13，研究相容性、lifecycle、
故障／模糊結果、cache／資源與公平效能；固定upstream9959fe2而不混入新master。
[STATUS](docs/STATUS.md) 是唯一任務帳：4 DONE、1 BLOCKED_ENV、4 TODO，未完成5項。
P0–P6是操作階段；P1a–f工具交付不等於MR-004完成。
不接production、不修改snail/Eru/kernel，不把研究擴成重寫Mithril或新control plane。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定來源與local fixture，When build／unit／離線lifecycle，Then artifact與基礎工具契約有可追溯結果。 | historical | [P1-LOCAL](docs/P1-LOCAL.md)、[VALIDATION](docs/VALIDATION.md)：22離線與121上游unit、build／fmt／Clippy紀錄。 |
| AC-02 | Given 六節點合成觀察與保留journal，When planner／collector／phase validator／intent執行，Then 不將提案或uncertain視為操作授權。 | historical | [P1-BOOTSTRAP](docs/P1-BOOTSTRAP.md)、[P1-COLLECTOR](docs/P1-COLLECTOR.md)、[P1-PHASE](docs/P1-PHASE.md)、[P1-JOURNAL](docs/P1-JOURNAL.md) 的離線／mock證據。 |
| AC-03 | Given 核准四機與有效網路／身分，When startup、cluster orchestration、fresh collection與清理，Then MR-004可依runtime證據驗收。 | pending | [STATUS](docs/STATUS.md) MR-004 BLOCKED_ENV；executor／resolution／實機准入及purge apply仍缺。 |
| AC-04 | Given 真實cluster，When SDK／兩輪lifecycle、migration/failover、cache與效能比較，Then C01–13及採用ADR有可核對結論。 | pending | [STATUS](docs/STATUS.md) MR-005–008 TODO；沒有相容性／故障／效能實機驗收。 |

## 現況與缺口

已交付研究、四機計畫及有界離線工具，不是僅有設計文件。
上游121 unit成功不等於四機proxy整合；collector僅mock驗證，freshness仍UNEXECUTED。
P1f同根保留journal會阻擋第二個intent，但沒有executor、resolution或phase advance。
新root／rollback不受跨根防重放保證；hash也不是認證或操作授權。
runtime image provenance、有效ACL／network、replication health及精確清理仍需補足。
真正live下一步仍依MR-004，不跳過環境前置到效能評分。

## 啟動與驗證

入口為 [quickstart](docs/quickstart.md) 與 [FOUR-NODE-PLAN](docs/FOUR-NODE-PLAN.md)。
[Makefile](Makefile) 提供 `make check`，執行stdlib unittest；`make demo` 是local fixture。
[scripts](scripts/) 保存labctl、bootstrap與journal工具；各CLI的private輸入依各自契約。
[EXECUTION_PROMPT](docs/EXECUTION_PROMPT.md) 列實機接手與批准範圍。
本次不讀私有inventory、不登入四機、不啟動Redis/Mithril或注入故障。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
須先關閉MR-004的完整P0/P1與runtime驗收，再完成MR-005–008既定實驗及決策。
離線工具與上游unit成功不足以建立整個Mithril lab的可用標記。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。
