# Mithril research status

更新：2026-10-17。狀態權威：本檔；研究基線：[upstream.lock.json](../upstream.lock.json)。

## 目前結論

P1a bounded offline core 已交付：strict inventory／artifact／plan 與僅 local-fixture 的 lifecycle、22 項離線測試及真 CLI demo；固定來源 release build、121 項上游 unit tests、Clippy／fmt 通過，見 [P1-LOCAL](P1-LOCAL.md) 與 [VALIDATION](VALIDATION.md)。私有 P0 唯讀紀錄有四台 SSH／Tailscale／資源／port／保留服務 metadata。這不是完整 P0 或 P1 的通過：有效服務存取政策、精確實機批准、startup／cluster orchestration、purge apply 及 P2/P3 尚未完成。P1b 的 private bundle／thin SSH down／purge preview 已通過 70 項離線 tests（Python 3.11／3.13）及本機驗證，工具與證據另見 [P1-TOOLS](P1-TOOLS.md)；工具存在不代表實機授權。P1c 的 [offline bootstrap planner](P1-BOOTSTRAP.md) 已加入 strict 六節點觀察／獨立 node ID map 驗證、17 typed actions 的四階段 proposal 及 private CLI；root Python 3.11／3.13 各通過 87 tests，實機 collector／phase executor 仍缺。P1d 的 [六節點唯讀 collector](P1-COLLECTOR.md) 新增固定 SSH helper、RESP2 framing、前後身分檢查與完整／部分結果；驗證限離線、mock SSH／runtime，實機 acquisition 與 freshness 仍為 UNEXECUTED，P1e 的 [獨立離線 phase validator](P1-PHASE.md) 檢查五個指定 barrier，沒有 phase advance／executor；實機 phase-aware validation 仍未驗收。MR-004 保持 BLOCKED_ENV，未完成數不變；下段為原始 M0 文件授權快照。

M0 靜態研究與四機使用計劃已完成文件交付；M1–M3 尚未驗證。Owner 已確認四台測試機，這一輪要求文檔先行、開 PR 並合併；沒有授權登入部署或故障注入。本檔不提前宣告 PR 已合併，整合狀態由 GitHub 紀錄確認。

操作路線見 [FOUR-NODE-PLAN](FOUR-NODE-PLAN.md)，交接見 [EXECUTION_PROMPT](EXECUTION_PROMPT.md)。舊單機 fixture 設計仍可作本機測試；四機 profile 不是把同一份 loopback/nopass conf 複製四次。

## 固定任務清單

| ID | 工作 | 依賴 | 狀態 | 證據／下一步 |
| --- | --- | --- | --- | --- |
| MR-001 | 倉庫政策、定位與 upstream pin | 無 | DONE | root policies、SOURCES、lock |
| MR-002 | 文件／關鍵程式碼研究與初判 | MR-001 | DONE | RESEARCH；原始閱讀範圍不變 |
| MR-003 | 實驗 SDD、範例與接手邊界 | MR-002 | DONE | SDD、quickstart、loopback conf |
| MR-004 | 四機盤點、artifacts、Linux fixture、native checks、精確清理 | MR-003、MR-009 | BLOCKED_ENV | P1a local/native core 有 evidence；完整 P0/P1 及 P2 尚未驗收，P1b／P1c／P1d／P1e 工具有獨立契約；P1c 只做離線 topology/proposal，P1d collector 只經 mock 驗證，P1e 只驗證輸入的離線 barrier；實機准入／完整啟動／精確資料清理與 runtime 驗收仍缺 |
| MR-005 | 核心相容性、SDK 與兩輪 lifecycle | MR-004 | TODO | P3；C01–C05、C11–C12、MR-R02 |
| MR-006 | migration/failover／ambiguous operations／第二代理 | MR-005 | TODO | P4；C06–C08、C13 |
| MR-007 | cache、backpressure 與資源回收 | MR-005 | TODO | P5；C09–C11；與 P4 實機操作互斥 |
| MR-008 | 公平效能複現與決策 ADR | MR-006、MR-007 | TODO | P6；先定義 SLO；四機混部限制明示 |
| MR-009 | 四機使用計劃、分階段驗收與自包含接手 Prompt | MR-003 | DONE | FOUR-NODE-PLAN、EXECUTION_PROMPT；只代表文件完成 |

共 9 項：4 DONE、1 BLOCKED_ENV、4 TODO；未完成共 5 項。計數只由本表產生。MR-004 的環境阻塞不是「每台缺 Rust」：預編譯 artifact 可用；但可用機器不等於身分、配置與權限已核實。

## 接續資訊

Repository：`https://github.com/fallrising/newclear`；項目：`labs/mithril-research/`；SSH remote：`git@github.com:fallrising/newclear.git`。本機 checkout 絕對路徑由實際工作環境解析，不能假造。

下一個動作是 MR-004 的剩餘 P0／P1：依 [AGENTS](../AGENTS.md) 全文讀取文件，核對 main/PR 與已有私有盤點，補齊有效服務准入／回復、Mithril runtime image provenance、startup／cluster execution 與 purge apply 工具；P1c 只完成離線觀察驗證／提案，P1d 只完成經 mock 驗證的唯讀 collector；P1e 只驗證給定 collection 的離線階段條件；實機 collection／freshness、phase-aware live validation 與 phase execution 尚未驗收。先輸出精確變更計劃及回復範圍，批准後才開始實機操作。

M1 起在 [VALIDATION](VALIDATION.md) 新增 run ID、artifact／環境身分、命令、退出碼、測例、去識別結果與限制，再依真實 evidence 更新任務。P0–P6 是步驟，不是另一份任務清單；文件完成不得讓 MR-004–008 變成 DONE。

## 範圍與版本

不接 production，不修改 kernel、snail、Eru、知識庫、共享 runtime 或 upstream。四台若與其他實驗共用，優先保留其服務與資料。研究 pin 不變；現有 runtime lock 記錄 Redis manifest 與 binary/native provenance，後續部署映像／SDK 精確版本仍須補齊。
