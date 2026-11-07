# M0 文件驗證紀錄

日期：2026-10-26。盤點基準：`65bbadb7659437e8a14f029015313c6f5277ce35`。

範圍：Cloud Lab 提案文件、repo 導航／inventory、任務與審查紀錄。沒有修改其他產品 runtime、搬資料、封存或部署。

## 狀態

M0 **本機文件候選已通過檢查及獨立審查**；主導接受文件範圍。產品仍是 `mainline: incomplete`、`usable_tag: none`，本機接受不代表 Git 交付或 owner 對整個產品驗收。

| 檢查 | 結果 | 證據 |
| --- | --- | --- |
| `python3 scripts/check_project_success.py --write-index` | passed | 44 個專案契約與索引；只新增 Cloud Lab 記錄 |
| `python3 scripts/check_indexes.py` | passed | 44 個 SUCCESS 契約、7 份 llms.txt、0 error；llms 掃描的新增文件已 staged |
| `python3 .team/cloud-lab-audit.py` | passed | 獨立複核當時 18 份文件、132 個連結、12 個來源 pin；範圍／靜態公開邊界無錯誤。最終補紀錄後計數以實際輸出為準 |
| `git diff --cached --check` | passed | 已含新檔，無空白錯誤 |
| 合成命令 walkthrough／狀態責任 | passed | 獨立閱讀並核對准入、排程、external_ref、協調 attempt、去重、取消、未知、驗證與遷移；沒有執行 runtime |
| 獨立審查與主導 accept/rework | passed | [T-811](../../../../.team/reports/T-811.md)：首次 REWORK，修正後 ACCEPT；[作者報告](../../../../.team/reports/T-810.md)保留原寫作範圍 |

## 審查與修正歷史

首次 index generation 發現 `contracts/README.md` 尚未整合，exit 1；整合 worker 文件後重跑通過，沒有弱化 validator。

獨立 reviewer 的 P2 指出原 submit grant／deadline 失效後，對帳如何取得新 fence 不清楚。修正為 `ClaimReconcile`：獨立有效的對帳 grant、reconcile_only mode、有限 lease；可查原 submission key／run 並補證，不得 submit／start／cancel 或延長原期限。架構同步區分協調 attempt 與原生執行。

P3 指出 `late` 與嚴格 Result 欄位不一致；改為接收端由 received_at 推導的 metadata，呼叫端不能自行填寫。驗收矩陣補兩個場景。focused follow-up 接受這兩項修正。

原始 review 與修正 review 的候選 diff SHA-256 保存在 T-811。最後只同步 SUCCESS、任務板、證據與主導決策，不改其接受的介面語義。檢查以共用 launcher 執行，原始日誌留在 project `cloud-lab` 的 tasks `M0-check-20261026`、`M0-rework-check-20261026`、`T-811-review-20261026`、`T-811-followup-20261026` 及最終 `M0-final-20261026` 的 `preserve/evidence/`；公開文件不帶機器專屬路徑。

## Evidence gate 對應

AC-01 → 知識樹、固定來源與連結檢查；AC-02 → contracts 及合成 walkthrough／P2/P3 複核；AC-03 → 架構責任表與既有元件邊界比對；AC-04 → 遷移矩陣、G0～G5 及回退條件；AC-05 → validators、diff、獨立 ACCEPT 與主導決策。主導檢查過全部新文件與索引 diff；未把 worker 的 DONE 當作產品完成。

## 限制

本次文件檢查不涵蓋 schema executable validation、Cloudflare bindings、真 runner、bot、手機、成本、入口封閉或資料恢復；這些均未執行，屬後續 runtime gate。上述本機驗證階段尚未 commit／push／PR／merge。Owner 已於 2026-10-26 明確批准本批文件的 commit、push、PR 審查與正常合併；實際交付連結及合併時間見[任務板](../tasks/BOARD.md)。部署仍未授權且未執行。
