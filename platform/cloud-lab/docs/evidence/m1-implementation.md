# M1 本機實作證據

候選基準 `e19cb853d21268a432ad9e35ed90510174e7e587`；owner 直接指示「好，繼續開發。」。本輪新增獨立控制面、固定 OS health runner 與看板；沒有搬動既有元件、部署或封存。

## 實際驗證

共用 workspace project `cloud-lab` 的證據：

| Task | 實際命令／結果 |
| --- | --- |
| M1-control-red | Node test，尚無 implementation，預期 module-not-found；原輸出保留 |
| T-812-red／T-812-red-unicode | runner 初始 red 與 strict JSON unicode 負向失敗，修正後 green；初次 socket sandbox 拒絕後經允許的 loopback escalation 重跑 |
| T-812-rework-final | Python unittest：31 passed，含真實 OS collector、持久 journal、重送、deadline 與 HTTP/HMAC |
| T-813-final | Node UI test：9 passed，syntax／diff check 通過；沒有聲稱瀏覽器互動驗收 |
| M1-integrated-2 | `python3 platform/cloud-lab/tools/check.py`：29 Node＋31 Python passed；原輸出 check-0.log／check-1.log |

整合測試使用真實本機 HTTP 與同一 Python runner，Node SQLite 執行正式 migration／SQL；合成 Access issuer/key 驗證 Worker auth path。這不是 workerd、Cloudflare D1 或真實 Access。Node 24.14.0／Python 3.13.5；Python3.11 executable 尚未在此環境執行。

## 獨立審查

T-812 runner、T-813 UI 作者各有有界任務／report；lead 整合與重跑。T-814 為不同模型獨立唯讀審查，初次 REWORK 發現 dispatch 權限縮減與 sample_age freshness 問題；兩者以回歸測試重現並修正。focused follow-up 為 ACCEPT；完整歷史見 [T-814 report](../../../../.team/reports/T-814.md)。lead 已核對 diff、實際輸出與 evidence gate，接受 M1-I1～I4 本機實作。

## 殘餘門檻

M1-LIVE、產品 AC-06～08 pending：真實 Workers/D1/Access、目標 runner、手機／bot 流程、撤權／入口、備份還原、容量與成本。沒有部署、usable tag 或完整產品完成宣告。

## 最終候選驗證與 evidence gate

- `M1-review-red`：新增兩個 regression，預期2個失敗，原證據保留。
- `M1-review-green`：`python3 platform/cloud-lab/tools/check.py`，31 Node＋31 Python passed。包含已有 dispatch lease 重回傳時重新驗 runner／submit grants、取消／schedule guard；sample_age 僅接受固定 collector 的0值。
- `T-814-followup`／`T-814-followup-boundaries`：獨立62項測試及重現複核通過；原 P2 findings 已關閉。
- `T-814-followup-docs`：44 project contracts、7 llms.txt、22份文件／169連結／12個 pinned來源及scope檢查通過。
- `M1-docs-check` 曾發現新 CSS 的 EOF 多餘空行，已移除並重跑 staged diffcheck 通過；未隱藏初次失敗。
- `M1-contracts-check`：T-812～814任務、T-812／813報告格式驗證通過；T-814與最終索引、scope／diff gate 在 `M1-final` 保存。

沒有 failed/skipped 的本機交付必要項；歷史 red／review findings 已修正。live、真實手機／bot、備份與Python3.11 runtime仍是獨立未完成門檻，不計入上述通過數。Git合併與CI結果在 [任務板](../tasks/BOARD.md) 收尾回讀後記錄。
