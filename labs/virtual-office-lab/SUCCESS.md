---
project: labs/virtual-office-lab
purpose: 以隱私最小化的公開狀態投影呈現多 Agent 虛擬辦公室
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-31
source_commit: 8bf48551f524086d81fa66d946c984f8052152ff
---

# 主線驗收

## 主線與範圍

完整目標是可公開訪問的 Three.js 辦公室、真實 Agent 上報、持久化與明確演示邊界。本次只交付 owner 要求的設計沉澱、完整 CLI、Workers 骨架與 Grok Bot 提示詞；不以 M0 文件／測試通過冒充整體完成。規格：[SDD](SDD.md)。非目標：新的調度平台、模型代理SDK、私有任務監看、付費呼叫、未授權部署。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given owner 抽象流程，When 接手者閱讀 SDD，Then 可確認六步流程、八狀態、佈局、隱私及既有平台邊界 | passed | [SDD](SDD.md)、[M0 review](docs/evidence/m0.md) |
| AC-02 | Given Node與合法設定，When CLI向實際loopback HTTP handler上報，Then狀態更新且自由摘要不出現在wire、80字限制與有界重試可驗證 | passed | [CLI tests](tests/cli.test.mjs)、[本機結果](docs/evidence/m0.md)；不是provider驗收 |
| AC-03 | Given Workers SQLite DO，When併發更新及重啟，Then版本、限流、去重與狀態持續且不丟更新 | pending | [骨架](src/worker.mjs)、[workerd smoke](tests/workerd-smoke.mjs)；本機純Node契約通過，實際runtime以CI證據為準 |
| AC-04 | Given任意具執行權限的Agent，When使用交接提示詞，Then有明確輸入、佈局、實作順序、上報方式與授權邊界 | passed | [完整提示詞](prompts/grok-bot.md)、[RUNBOOK](docs/RUNBOOK.md)；人工文件檢查，非模型執行驗收 |
| AC-05 | Given新元件與任務認領，When提交Draft PR，Then索引、必要CI、遠端SHA與回讀可追溯 | pending | [BOARD](docs/tasks/BOARD.md)、[證據](docs/evidence/m0.md)；全倉檢查與PR檢查結果需以實際遠端為準 |
| AC-06 | Given live或明示demo狀態，When瀏覽3D辦公室，Then八狀態、協作、stale、斷線、夜間overlay、無障礙與安全文字呈現正確 | pending | Three.js前端與瀏覽器測試尚未實作，不以文件佈局代替 |
| AC-07 | Given一個真實Agent執行端，When執行無敏感的已授權任務，Then開始、執行、完成由hook實際上報且可由畫面觀察 | pending | 未取得／執行真實宿主接入；HTTP測試替身與人工命令不算 |
| AC-08 | Given owner批准公開環境，When空白正式namespace部署並重啟／復原／撤權，Then公開狀態正確、秘密不洩漏、demo不污染live | pending | 未授權也未部署；[驗收關卡](docs/RUNBOOK.md) |

## 本次開發範圍：T-0002

補強 AC-03 真 local workerd／SQLite 重啟後的去重與限流證據：填滿 12 次配額後重啟，相同事件可安全重送、同 ID 不同內容回 409、新事件仍回 429，拒絕與重送不改公開狀態。使用真實分鐘窗口，不替換 runtime 時鐘。Node 28 項測試、真 workerd、索引與 success contract 檢查均已通過，見[本輪證據](docs/evidence/m1-persistence.md)；完整 M1 的真 Agent 接入及 AC-06～08 仍未完成。

## T-0003 開發範圍

新增 opt-in `office-run` 命令生命週期 adapter：開始上報 terminal，正常退出上報 done，失敗上報 error；不擷取或上傳命令與輸出。開始上報失敗不得啟動命令，最終上報失敗不得回傳整體成功。35 項 Node 測試及真 workerd 命令上報已通過，包含實際子程序與憑證隔離，見[本輪證據](docs/evidence/m1-lifecycle.md)；這不是原生 Agent hook、瀏覽器觀察或完整 AC-07 驗收。

## T-0004：取消處理

已驗證 SIGINT/SIGTERM 轉送、5 秒後強制終止、取消後上報 error 而非 done，以及正常退出後清理 signal listeners。39 項 Node 測試、真 workerd 與全倉檢查通過，見[證據](docs/evidence/m1-cancellation.md)。使用真子程序測試，不以原生 Agent hook 或前端驗收代稱。

## T-0005：長命令 heartbeat

每 5 分鐘固定 terminal 上報、不傳命令內容；單一 in-flight，結尾等 heartbeat 完成再送 done/error。驗證慢請求無重疊、結尾不被晚到 heartbeat 覆寫、上報失敗可見且不重跑命令。43 項測試、真 workerd、全倉檢查通過，Claude Opus 5.5 二輪 review 無 blockers；[證據與審查範圍](docs/evidence/m1-heartbeat.md)。完整 AC-07 仍 pending。

## T-0006：呈現模型

建立 renderer-neutral 純函式供未來 Three.js／文字 fallback 共用。AC-06 子範圍：八狀態、stale 保留 alert、互相同意協作才移動、固定排序座位、夜間 overlay 預設關閉且不遮蔽警示。48 項 Node tests、索引與模型 review 通過，見[介面與證據](docs/PRESENTATION.md)；未實作瀏覽器／WebGL／移動路徑，不把此基礎視為完整 M2 或 AC-06 完成。

## T-0007：文字 fallback 頁面

實作本機唯讀頁、單一 in-flight polling、隱藏暫停、jitter/backoff、斷線與上次成功標示及安全文字呈現。51 項 Node 測試與實際 Chrome smoke 已通過，見[證據](docs/DASHBOARD.md)；未實作 Three.js、相機／路徑與完整瀏覽器狀態矩陣，完整 AC-06 保留 pending。

## 現況與缺口

已具設計、CLI、API安全核心與Workers adapter。28項本機Node測試通過，包含真loopback HTTP；storage test double不等於DO恢復。當前未建立完整3D UI、未真正接入模型宿主、未公開部署。CI與runtime結果需對照當次PR，不能從workflow存在推論通過。

## 啟動與驗證

[README](README.md)、[RUNBOOK](docs/RUNBOOK.md)。`npm run check`、`npm test`；另以固定Wrangler執行`tests/workerd-smoke.mjs`。repo驗證：`python3 scripts/check_indexes.py`。每種證據的範圍見[M0](docs/evidence/m0.md)。

## 可用版本

`usable_tag: none`。本次不是release或deploy。只有全主線AC、必要CI／審查、合併及owner批准後才可建立annotated usable tag；不得移動或force覆寫tag。
