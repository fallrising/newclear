# dim-gate 狀態

更新：2026-09-20

任務與接受決策以 [PLAN](../../../.team/PLAN.md) 為入口，並核對 Git／PR／CI。不要重新建立目前已有的 M0 任務或分支。

## 目前實際進度

M0 已在 `agent/dim-gate/mainline/m0-foundation` 實作，已建立 [Draft PR #7](https://github.com/fallrising/newclear/pull/7)，正在修正獨立 review 發現，尚未接受或合併。三個 worker 已交回隔離工作區結果；主控整合契約、工具鏈、CI 與瀏覽器驗收。

可操作範圍：三中心授權摘要、四個 persona、固定示範標示、時鐘／刷新保存／確認重置、損毀資料明示恢復。共用 domain + MSW + API client 已提供授權、版本競爭、冪等與原子儲存。最小 seed 為三來源各一筆 CI，完整 60 CI 與業務主線尚未提供。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | 實作已整合；初始 CI 通過；獨立 review 修正與複核進行中 |
| M1：CMDB與應用視圖 | 尚未開始 |
| M2：申請與平台治理 | 尚未開始 |
| M3：CI/CD與回滾 | 尚未開始 |
| M4：觀測與完整展示 | 尚未開始 |
| M5：驗收與展示交付 | 尚未開始 |

## 證據入口

- [完整閱讀／恢復核對](../../../.team/reports/dim-gate-m0-preflight.md)：newclear `1117d297aa3efef9472d847c9dfa5714eb6c4460`、kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`。
- [領域 report](../../../.team/reports/T-001.md)、[傳輸 report](../../../.team/reports/T-002.md)、[UI report](../../../.team/reports/T-003.md)：worker 的 scoped 結果與歷史失敗；不是主控接受決策。
- [M0 契約](M0-CONTRACT.md)、[OpenAPI](openapi.json)、[本機執行](../README.md)。

初步整合測試 79 passed，production Chromium153 E2E 7 passed，三寬度與明暗主題 axe 無 serious/critical。初始固定 candidate `e7d74275b1bbf157ab8d1888e3d482e95fb647b2` 與本地被測 tree 相同，[遠端 CI](https://github.com/fallrising/newclear/actions/runs/35509526982) 也已通過。獨立 review 另外發現舊操作重試可回寫過期身分及預設排序不一致；正在精確修正，先前綠燈不能作為最終接受。Playwright CDN 在本環境失敗，使用本地 Chromium bundle 與測試用 Noto CJK；遠端 CI 使用標準 Playwright Chromium。

沒有部署、真實雲連線或完整 v0.1 展示驗收。初始 JS gzip 約317.5KiB，高於 M5 的300KiB預算，仍需後續拆分及指定條件下的效能量測。

## 下一步

沿用 T-004/T-005 與既有 branch：固定 candidate、執行 clean native gates、完成獨立 review，由主控更新同一個 PR #7；不能重複建立。具體 resume 與 remote durability 見 PLAN。
