# Cloud Lab 任務板

## T-0001 — M0 文件與契約設計

元件內任務 ID；輸入為 owner 本次直接指示「文檔先行，開始」。範圍依 [SDD](../../SDD.md)／[SUCCESS](../../SUCCESS.md)，只交付文件與導航。主導負責整合、審查與 accept/rework。本機文件 AC-01～05 與獨立審查已通過；owner 明確批准 Git 交付後，[PR #669](https://github.com/fallrising/newclear/pull/669) 已於 2026-10-26T15:41:57Z 正常合併。合併 commit：`b6bb31bf3284fd755e4ca58492ac494fb9908a1e`。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-1 | 知識樹、能力及來源映射 | AC-01 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-2 | 身分、任務、事件、成果及 Recipe 契約 | AC-02 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-3 | 狀態、部署與跨元件責任 | AC-03 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-4 | 遷移、接替、回退與封存條件 | AC-04 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-5 | 導航、驗證、獨立審查與 evidence gate | AC-05 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |

M1／M2／M3 是[後續計畫](../verification.md)，沒有因本次文件工作自動開始。產品 AC-06～08 保持 pending。

## M0 交付與回讀

- PR head：`b16fe916e1662f75225ab04f2f0722797c6ebc9d`；獨立 review ACCEPT 見 [T-811](../../../../.team/reports/T-811.md)，先前 REWORK 與修正歷史保留。
- 必要 CI：[Project success contracts](https://github.com/fallrising/newclear/actions/runs/40351726014) 與 [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/40351725548) 均 SUCCESS；合併前 head 未變、無衝突，正常 merge，未繞過檢查。
- 本機交付前：44 個專案契約、7 份 llms.txt、18 份 Cloud Lab 文件、135 個連結、12 個固定來源、scope／diff 檢查通過。原始輸出保存在 shared-workspace project `cloud-lab`／task `M0-publish-check-20261026` 的 `preserve/evidence/`。
- 合併後 fetch main，逐一比較本次 29 個交付路徑的 Git 內容與已驗證 head，無差異；PR API 回讀 merged=true、合併 SHA 與上述時間相符。
- 本次收尾只更新任務板。M0 文件交付完成；產品主線仍 incomplete、沒有 usable tag；尚無 runtime／Cloudflare live 驗收，未搬程式、封存或部署。
