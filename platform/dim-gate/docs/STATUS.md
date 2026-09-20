# dim-gate 狀態

更新：2026-09-20。任務、證據與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

M0（AC-01–03）已驗收並由 [PR #7](https://github.com/fallrising/newclear/pull/7) 合併為 `50294b687d06f08e94290f6f327187e8f69248bc`；未部署。

M1（AC-04–08、AC-20）已在產品／本機測試 commit `784f771a040be72fedf2f1521912900990c09dbf` ACCEPTED。[PR #11](https://github.com/fallrising/newclear/pull/11) 已合併為 `b8dae76034caf63bf7d0721cba99a58a0586ae85`；合併後 CI run 35531246949 通過，未部署。

M1 可操作範圍：

- `/rd/apps`、應用與環境詳情，使用共用 Application／Environment／Placement／CI ID 與合法跨 Center deep link。
- `/ops/cmdb`、CI 詳情、三 provider filter、手動納管與 metadata-only 編輯。
- `/ops/topology` dependencies／impact、cycle-safe BFS、最多 3 hops／100 nodes／200 edges、可見 truncation 與表格替代視圖。
- scoped global search、action-aware route registry、persona/scope cache 隔離與在途舊 response 抑制。
- 固定 `dim-gate-m1-v1` seed：60 CIs（AWS、Aliyun、on-prem 各 20）、6 applications、12 environments、共享 Redis placements 與 relations。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | ACCEPTED；PR #7 MERGED |
| M1：CMDB與應用視圖 | ACCEPTED at `784f771`；PR #11 MERGED at `b8dae760` |
| M2：申請與平台治理 | RUNNING；T-014 shared domain/API accepted checkpoint；Draft PR #13 |
| M3：CI/CD與回滾 | 尚未開始 |
| M4：觀測與完整展示 | 尚未開始 |
| M5：驗收與展示交付 | 尚未開始 |

證據：122/122 tests、11/11 production E2E、全部 native/docs/contracts/CI/architecture/actionlint gates、獨立 T-012 attempt-2 ACCEPTED，以及 GitHub Actions run 35526733678 成功。該 run 對 head `784f771` 與 synthetic merge `796960eae34bce6463e921c1b7527ba2da565ebb` 執行；最後 reconciliation main 是 `a5982bf4547bba85429fec50494751562b5fe7c6`。E2E 保留 7 項 M0 regression，涵蓋 1440／768／390、明暗主題、axe serious/critical、keyboard/focus/dialog、`/dim-gate/` refresh、reset/reload/copied-tab/corrupt persistence、topology 與 AC-20 在途 persona response。

後續在 evidence head `364b3cc2` 完成一輪[實際 production-like 無頭 Chromium walkthrough](../../../.team/reports/dim-gate-m1-browser-walkthrough.md)：10/10 操作流程及 24/24 route／viewport／theme 組合通過，axe serious/critical、overflow、page error、failed request 與非預期 console/network error 均為 0；另重新通過 122/122 tests、11/11 production E2E 與全部 gates。此證據不改變 accepted implementation `784f771`，也不把 PR OPEN 誤寫為已合併。

獨立 review attempt 1 的 F-01 relation audit 跨 scope 洩漏與 F-02 舊 M0 seed 靜默沿用皆保留為歷史 BLOCKED 證據；revision 2 修正後，Commerce audit 為空、Ops 保有兩筆歷史事件，舊 snapshot bytes 在明確 recovery 前不變，reset 得到 60 CI。attempt 2 無 blocking finding。

M2 T-014 在 `a9e64276273fc3698105c2bf8b0b7bc833444057` 完成 shared domain/API checkpoint：132/132 tests、11/11 production Chromium regression 與全部 native gates 通過；request/capacity/provision retry、access/navigation/catalog/model governance 和 M1→M2 explicit recovery 已可由共用 handler 執行。Draft [PR #13](https://github.com/fallrising/newclear/pull/13) 已開啟，remote run 35534450528 正在執行。這不代表 M2 ACCEPTED；M2 UI、browser walkthrough 與 independent review 尚未完成。

限制：production JS 為 419.77 kB gzip，仍是 M5 的 300 kB 預算風險；reviewer 的額外 Ops dialog/topology browser checks 尚未寫入 repository test。沒有部署、真實雲操作、付費服務或全域權限變更。

Resume：從 `agent/dim-gate/mainline/m2-governance` 的 `a9e6427` 接續 RD/Ops self-service 與 Admin governance UI；base 是合併後 main `b8dae760`。M2 尚未 ACCEPTED，PR #13 是 Draft，未部署。
