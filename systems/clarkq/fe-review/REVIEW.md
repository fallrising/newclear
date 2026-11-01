# FE Review — ClarkQ — REVIEW

## 目前輪次

原 R2（已批准DESIGN M1–M3）候選實作與驗證完成；獨立審查、必要CI／發布為後續門檻。完整 R3尚未執行。[報告](tasks/round2/report.md)與[索引](tasks/round2/result.json)保留實際範圍及歷史。

## 已落地決定

2026-10-23 owner確認D1：單程序Go＋authenticated API seed。現有[RUNNER](RUNNER.md)使用全新專有state/key、明確環境allowlist、loopback／RF1、owned程序及bounded cleanup；不採既有demo/正式資料。

實測後修正長queue手機overflow、primary button對比、JSON/log keyboard regions、空Actions header及五秒更新焦點。使用者已將焦點移開時不搶回。只有queues自動刷新；Metrics/Cluster仍須Refresh all。

## 目前發現與限制

- 既有瀏覽器預設GET `/favicon.ico` 回404。final-001匿名console404原FAIL保留；final-002以同origin精確URL、GET、initiator other、404同request、ExtraInfo無key/cookie/auth及console/CDP Log關聯確認。列為未修呈現問題，不新增favicon資產，不豁免未知404。
- 最後三尺寸axe violations0/incomplete0；這是本次畫面實測，不外推所有資料或完整WCAG人工驗收。
- 六個預期API401、一個非法名400、一次精確受控網路ERR_FAILED及八個相應console事件均保留；不稱零health。
- 不新增pending/duplicate產品修正；本輪未觀察到需要改動該語意的證據。
- 固定深色、單節點。真OIDC/TLS、cluster、production、負載及完整R3不在本輪。

## 權限

文檔檔位C（dormant）FE例外，僅[DESIGN](DESIGN.md)範圍；不恢復新功能投入或升級依賴。保留既有單機可用資格，不新增tag／部署。
