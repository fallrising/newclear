# Mithril research status

更新：2026-09-27。狀態權威：本檔；研究基線：[upstream.lock.json](../upstream.lock.json)。

## 目前結論

M0 靜態研究與四機使用計劃已完成文件交付；M1–M3 尚未驗證。Owner 已確認四台測試機，這一輪要求文檔先行、開 PR 並合併；沒有授權登入部署或故障注入。本檔不提前宣告 PR 已合併，整合狀態由 GitHub 紀錄確認。

操作路線見 [FOUR-NODE-PLAN](FOUR-NODE-PLAN.md)，交接見 [EXECUTION_PROMPT](EXECUTION_PROMPT.md)。舊單機 fixture 設計仍可作本機測試；四機 profile 不是把同一份 loopback/nopass conf 複製四次。

## 固定任務清單

| ID | 工作 | 依賴 | 狀態 | 證據／下一步 |
| --- | --- | --- | --- | --- |
| MR-001 | 倉庫政策、定位與 upstream pin | 無 | DONE | root policies、SOURCES、lock |
| MR-002 | 文件／關鍵程式碼研究與初判 | MR-001 | DONE | RESEARCH；原始閱讀範圍不變 |
| MR-003 | 實驗 SDD、範例與接手邊界 | MR-002 | DONE | SDD、quickstart、loopback conf |
| MR-004 | 四機盤點、artifacts、Linux fixture、native checks、精確清理 | MR-003、MR-009 | BLOCKED_ENV | P0–P2：目標身分／資源／網路與實機批准未核對；最先做 P0，不先安裝 |
| MR-005 | 核心相容性、SDK 與兩輪 lifecycle | MR-004 | TODO | P3；C01–C05、C11–C12、MR-R02 |
| MR-006 | migration/failover／ambiguous operations／第二代理 | MR-005 | TODO | P4；C06–C08、C13 |
| MR-007 | cache、backpressure 與資源回收 | MR-005 | TODO | P5；C09–C11；與 P4 實機操作互斥 |
| MR-008 | 公平效能複現與決策 ADR | MR-006、MR-007 | TODO | P6；先定義 SLO；四機混部限制明示 |
| MR-009 | 四機使用計劃、分階段驗收與自包含接手 Prompt | MR-003 | DONE | FOUR-NODE-PLAN、EXECUTION_PROMPT；只代表文件完成 |

共 9 項：4 DONE、1 BLOCKED_ENV、4 TODO；未完成共 5 項。計數只由本表產生。MR-004 的環境阻塞不是「每台缺 Rust」：預編譯 artifact 可用；但可用機器不等於身分、配置與權限已核實。

## 接續資訊

Repository：`https://github.com/fallrising/newclear`；項目：`labs/mithril-research/`；SSH remote：`git@github.com:fallrising/newclear.git`。本機 checkout 絕對路徑由實際工作環境解析，不能假造。

下一個動作是 MR-004 / P0，依 [AGENTS](../AGENTS.md) 全文讀取文件，核對 main/PR 與已授權 inventory，再列／執行獲准的唯讀盤點。先輸出精確變更計劃及回復範圍，批准後才開始實機操作。

M1 起在 [VALIDATION](VALIDATION.md) 新增 run ID、artifact／環境身分、命令、退出碼、測例、去識別結果與限制，再依真實 evidence 更新任務。P0–P6 是步驟，不是另一份任務清單；文件完成不得讓 MR-004–008 變成 DONE。

## 範圍與版本

不接 production，不修改 kernel、snail、Eru、知識庫、共享 runtime 或 upstream。四台若與其他實驗共用，優先保留其服務與資料。研究 pin 不變；Redis／映像／SDK 精確執行版本由未來 runtime lock 另外管理。
