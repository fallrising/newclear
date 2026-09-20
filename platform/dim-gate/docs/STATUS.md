# dim-gate 狀態

更新：2026-09-20。任務、證據與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

M0（AC-01–03）已驗收並由 [PR #7](https://github.com/fallrising/newclear/pull/7) 合併為 `50294b687d06f08e94290f6f327187e8f69248bc`；未部署。

M1（AC-04–08、AC-20）已在產品／本機測試 commit `784f771a040be72fedf2f1521912900990c09dbf` ACCEPTED。[PR #11](https://github.com/fallrising/newclear/pull/11) 是 OPEN 且 Ready for Review，尚未合併；milestone ACCEPTED、PR OPEN 與 PR MERGED 是三個不同狀態。

M1 可操作範圍：

- `/rd/apps`、應用與環境詳情，使用共用 Application／Environment／Placement／CI ID 與合法跨 Center deep link。
- `/ops/cmdb`、CI 詳情、三 provider filter、手動納管與 metadata-only 編輯。
- `/ops/topology` dependencies／impact、cycle-safe BFS、最多 3 hops／100 nodes／200 edges、可見 truncation 與表格替代視圖。
- scoped global search、action-aware route registry、persona/scope cache 隔離與在途舊 response 抑制。
- 固定 `dim-gate-m1-v1` seed：60 CIs（AWS、Aliyun、on-prem 各 20）、6 applications、12 environments、共享 Redis placements 與 relations。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | ACCEPTED；PR #7 MERGED |
| M1：CMDB與應用視圖 | ACCEPTED at `784f771`；PR #11 OPEN / READY / NOT MERGED |
| M2：申請與平台治理 | 尚未開始 |
| M3：CI/CD與回滾 | 尚未開始 |
| M4：觀測與完整展示 | 尚未開始 |
| M5：驗收與展示交付 | 尚未開始 |

證據：122/122 tests、11/11 production E2E、全部 native/docs/contracts/CI/architecture/actionlint gates、獨立 T-012 attempt-2 ACCEPTED，以及 GitHub Actions run 35526733678 成功。該 run 對 head `784f771` 與 synthetic merge `796960eae34bce6463e921c1b7527ba2da565ebb` 執行；最後 reconciliation main 是 `a5982bf4547bba85429fec50494751562b5fe7c6`。E2E 保留 7 項 M0 regression，涵蓋 1440／768／390、明暗主題、axe serious/critical、keyboard/focus/dialog、`/dim-gate/` refresh、reset/reload/copied-tab/corrupt persistence、topology 與 AC-20 在途 persona response。

獨立 review attempt 1 的 F-01 relation audit 跨 scope 洩漏與 F-02 舊 M0 seed 靜默沿用皆保留為歷史 BLOCKED 證據；revision 2 修正後，Commerce audit 為空、Ops 保有兩筆歷史事件，舊 snapshot bytes 在明確 recovery 前不變，reset 得到 60 CI。attempt 2 無 blocking finding。

限制：production JS 為 413.17 kB gzip，仍是 M5 的 300 kB 預算風險；reviewer 的額外 Ops dialog/topology browser checks 尚未寫入 repository test。M1 不宣稱完成 M2 Admin 功能，也未新增空白 Admin 頁。沒有部署、真實雲操作、付費服務或全域權限變更。

Resume：從 SSH remote branch `agent/dim-gate/mainline/m1-cmdb` 與 OPEN PR #11 繼續 repository-owner review；不得重做 M1、不得自動 merge。下一開發 milestone 是 M2，開始前須重新 reconcile main／PR 並保留本輪 T-012／T-013 evidence。
