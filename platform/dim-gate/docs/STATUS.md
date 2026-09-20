# dim-gate 狀態

更新：2026-09-20。任務與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

M0（AC-01–03）已由主控驗收，實作 commit `695e962304276ab80885c985ce0f7287b15b4698` 已由 [PR #7](https://github.com/fallrising/newclear/pull/7) 合併為 `50294b687d06f08e94290f6f327187e8f69248bc`；尚未部署。

可操作範圍：三中心授權摘要、四個 persona、固定示範標示、時鐘／刷新保存／確認重置、損毀資料明示恢復。共用 domain、MSW、API client 提供授權、版本競爭、冪等與原子儲存；OpenAPI 由共用 schema 產生。最小 seed 為三來源各一筆 CI，完整 60 CI 與業務主線尚未提供。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | ACCEPTED；PR #7 MERGED |
| M1：CMDB與應用視圖 | 進行中；T-006 架構與 T-007 共用 domain/60-CI seed 已接受，UI slices 待整合 |
| M2：申請與平台治理 | 尚未開始 |
| M3：CI/CD與回滾 | 尚未開始 |
| M4：觀測與完整展示 | 尚未開始 |
| M5：驗收與展示交付 | 尚未開始 |

82 項測試、7 項 production E2E、原生 gates 與 [遠端 CI](https://github.com/fallrising/newclear/actions/runs/35513835780) 全數通過。[獨立審查](../../../.team/reports/T-004.md) 發現的過期身分重試與排序契約問題已修復並複核；原始失敗報告保留。[整合驗收](../../../.team/reports/T-005.md) 記錄精確 code/spec/CI commit、截圖 artifact、較新 main 的差異核對及環境限制。

[完整閱讀／恢復核對](../../../.team/reports/dim-gate-m0-preflight.md) 使用 newclear `1117d297aa3efef9472d847c9dfa5714eb6c4460`、kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`；最終核對 main `a330237860b3002d68fec3f853a6d1deb44a8e9a` 並全文追讀更新的 CI 規則。實際為內建多 agent 協作，未聲稱使用不可用的 Claude 或已驗證的多模型路由。

下一步：在 `agent/dim-gate/mainline/m1-cmdb` 完成 T-006 架構整理與 M0 regression，再固定 M1 integration contract，接續 AC-04–08、20。M1 尚未 ACCEPTED、尚無 PR；resume pointer 與證據見 PLAN。完整 v0.1 尚未驗收；初始 JS gzip 約317.5KiB，M5 的300KiB預算及其他效能量測仍待處理。

最後一輪 CI 曾發現深色切換的按鈕色彩過渡短暫對比不足；已移除過渡，原驗收不變。第三輪獨立複核與新 CI 通過，PLAN DG-D010 重新接受 M0。原始失敗 run35513677939 與審查歷史均保留。
