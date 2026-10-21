# dim-gate 可用版本資格

RESULT: PASS
Project: platform/dim-gate
Tag: usable/dim-gate/v0.1.0
Source: b97319d74f8442b5173ef42be72a0aa757d87df0
Startup: production demo shell 與 aws／aliyun／onprem Guide — passed
Core: 四條實際 Chromium 診斷／恢復流程，既有完整 E2E 以 runtime 零差異核對保留 — passed
Checks: 426 tests、lint/typecheck/docs/contracts/architecture/CI/build — passed

範圍：本機 mock demo，M0–M5／W1–W5；沒有雲端控制面或部署。

2026-10-21 實跑證據：[原生 checks](../evidence/newclear-qualification/dim-gate-commands.json)、[啟動與核心流程](../evidence/newclear-qualification/dim-browser-attempt3-commands.json)；完整命令／輸出按同目錄 evidence index 逐項保留。
測試 checkout d62cf11d722f229c3a048e4021282aa5783b976e 的六個候選 component trees 與上列 Source 完全一致；本 PR 對產品只新增／修正文檔，未修改 runtime、依賴或設定。
資格不外推未列範圍。必要 PR CI／獨立審查及合併版本核對仍是發布上述預定 tag 的 gate；發布結果以遠端 Git ref 與需求卡交付紀錄為準。

既有完整 W5 E2E／cross-browser／benchmark／isolation 為歷史驗收，不能冒充本次重跑。[來源差異](../evidence/newclear-qualification/dim-gate-historical-source.json)確認 accepted 616d67e 後 src/e2e/package/lock/browser-config 無變；現行 docs／CI evidence scripts 已另外重驗。首次 host Chromium 缺 libnspr4、第一次隔離容器 cache 唯讀錯誤保留在 attempt1／2；僅調整測試容器 tmpfs 後 attempt3 通過，沒有改產品或 host 套件。
