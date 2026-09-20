# dim-gate 狀態

更新：2026-09-20。任務、證據與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

M0（AC-01–03）已由主控驗收並由 [PR #7](https://github.com/fallrising/newclear/pull/7) 合併為 `50294b687d06f08e94290f6f327187e8f69248bc`；未部署。M1 目前是已通過本機完整 gates 的 review candidate `9b656f276ef9f5dd3b18f8ca698bea6496751839`，位於 Draft [PR #11](https://github.com/fallrising/newclear/pull/11)，尚未標記 milestone ACCEPTED、尚未合併。

M1 可操作範圍包含：

- `/rd/apps`、應用詳情與環境詳情，使用共用 Application／Environment／Placement／CI ID。
- `/ops/cmdb`、CI 詳情、三 provider filter、手動納管與允許的 metadata 編輯。
- `/ops/topology` 的 dependencies／impact、1–3 hops、cycle-safe BFS、truncation 與表格替代視圖。
- shell 全域搜尋、action-aware route registry、cross-Center canonical deep link 與 persona/scope cache 隔離。
- exactly 60 baseline CIs（AWS、Aliyun、on-prem 各 20）、6 applications、12 environments、共享 Redis placements 與 relations。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | ACCEPTED；PR #7 MERGED |
| M1：CMDB與應用視圖 | RUNNING；candidate `9b656f2` 本機 gates 通過；T-012 review 與 current remote CI 待完成；PR #11 DRAFT |
| M2：申請與平台治理 | 尚未開始 |
| M3：CI/CD與回滾 | 尚未開始 |
| M4：觀測與完整展示 | 尚未開始 |
| M5：驗收與展示交付 | 尚未開始 |

候選 commit 的證據為 120 項測試、11 項 production E2E、所有 native/docs/contracts/CI/architecture/actionlint gates。E2E 同時保留 7 項 M0 regression，並驗證 1440／768／390、明暗主題、axe serious/critical、keyboard/focus/dialog、`/dim-gate/` refresh、reset/reload/copied-tab/corrupt persistence，以及 AC-20 在途 persona response 不洩漏。

限制：目前 production JS 為 413.08 kB gzip，仍是 M5 的 300 kB 效能預算風險；M1 不宣稱完成 M2 Admin 功能，也未新增空白 Admin 頁。沒有部署、真實雲操作、付費服務或全域權限變更。

下一步：固定 evidence checkpoint、SSH push、由未參與實作的 T-012 reviewer 審查 immutable candidate，等待 PR #11 current synthetic-merge CI；只有 review 無 blocking finding 且 remote CI 全綠後，T-013 才可將 M1 標為 ACCEPTED 並把 PR 設為 Ready for Review。不得自動 merge。
