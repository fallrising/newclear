# Graphify lab 技術任務板

## T-0001 — 開發場景與單份參考實驗

來源：owner 於 2026-10-29 直接指示。Session `Graphify-20261029`；base `68c92afda47187ec40a8dff319eb377da9998145`；branch `agent/graphify-lab-20261029`。
主導負責整合與 Git 交付；worker 分別研究上游、實作 cache 與 scenarios；獨立 reviewer 核對證據與正負例。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 固定版本與來源 | AC-01 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-02 | 導覽與呼叫路徑 | AC-02 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-03 | 真實元件參考 | AC-03 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-04 | 影響與測試線索 | AC-04 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-05 | 更新與失效 | AC-05 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-06 | 跨圖與歧義控制 | AC-06 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-07 | 共用 cache | AC-07 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-08 | 空間與時間量測 | AC-08 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |
| T-0001-09 | MCP／CI／審查與交付 | AC-09 | done | 2026-10-29T13:38:06Z | 2026-10-29T14:14:07Z | 2026-10-29T14:15:05Z |

## 驗證與交付

- Runtime commit：`011fa8cac6137735b576e14b5695ea26544e91db`；GitHub app 原子 tree／commit、非 force fast-forward、回讀 ref／tree。
- [PR #759](https://github.com/fallrising/newclear/pull/759)；[SUCCESS](../../SUCCESS.md) 的 AC-01～09 均有實際通過證據。
- [7 組場景、29 項邊界測試、4 項 CI](../evidence/README.md)，[獨立 ACCEPT](../evidence/review.md)；唯一 P2 cache context 問題已修復。
- 原交付時維持 Draft／in_progress；owner 其後明確指示「合併PR」，已按下列回讀結果完成合併與結案。
- 上游 private paths／付費 API／部署沒有納入這次公開實驗；已知解析與效能解讀邊界仍保留。

## 合併結案

- Owner merge 授權：2026-10-29，本次對話「合併PR」。
- [PR #759](https://github.com/fallrising/newclear/pull/759) 已於 `2026-10-29T14:14:07Z` 合併至 `main`；merge commit：[`f799a8f8a816dee05f67aa503100cd229d6e8ad1`](https://github.com/fallrising/newclear/commit/f799a8f8a816dee05f67aa503100cd229d6e8ad1)。所有列的 `end` 均採 GitHub 回傳的實際 `merged_at`。
- 合併前確認 accepted head `d3d48f10493eb7c59fa705a8bda3414fa365b3a4` 的四項 CI 全數成功、無衝突、無未解決 review threads，獨立 reviewer 維持 ACCEPT；以 expected head SHA 正常 merge。
- 合併後回讀 PR `merged=true`、`main` ref 與 merge parents；合併 tree `83d421ac355e448736842f71363ce6c72606b0d0` 與已驗收 head 完全相同。
- 依根目錄任務合約，以只修改本任務板的後續 PR 將 T-0001／AC-01～09 結案。其餘文件的 Draft／待 merge 記載保留為原交付時的歷史快照，以本節為最新狀態；未建立 release／tag 或部署。

## T-0437 — 文件結案與真實開發任務試點

來源：[desk T-0437](https://github.com/fallrising/desk/blob/main/tasks/T-0437-graphify-development-pilot/task.md)；owner 2026-10-29 批准逐里程碑提交／PR／合併。
設計與 AC：[development-pilot](../milestones/development-pilot.md)。原 T-0001 與 AC-01～09 結果保留。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0437-M1 | 同步第一輪已合併／已完成狀態與索引 | M1 | done | 2026-10-29T16:58:00Z | 2026-10-29T17:07:58Z | 2026-10-29T17:07:58Z |
| T-0437-01 | 固定來源與真 graph 導覽 | P-01 | done | 2026-10-29T17:09:23Z | 2026-10-29T17:19:03Z | 2026-10-29T17:19:03Z |
| T-0437-02 | 共用來源模組重構與回歸 | P-02 | done | 2026-10-29T17:09:23Z | 2026-10-29T17:19:03Z | 2026-10-29T17:19:03Z |
| T-0437-03 | 本機 agent recipe 與真 MCP | P-03 | done | 2026-10-29T17:09:23Z | 2026-10-29T17:19:03Z | 2026-10-29T17:19:03Z |
| T-0437-04 | 可重跑對照與誠實成本紀錄 | P-04 | done | 2026-10-29T17:09:23Z | 2026-10-29T17:19:03Z | 2026-10-29T17:19:03Z |
| T-0437-05 | 證據、獨立審查、CI 與交付 | P-05 | done | 2026-10-29T17:09:23Z | 2026-10-29T17:19:03Z | 2026-10-29T17:19:03Z |

M1：[PR #775](https://github.com/fallrising/newclear/pull/775) 於 2026-10-29T17:07:58Z 合併，commit `97d3e6f262e7c2ffb59b2c1c99bb284ecff28442`；兩項 CI success，獨立 ACCEPT，遠端已回讀。

M2：[PR #778](https://github.com/fallrising/newclear/pull/778) 於 2026-10-29T17:19:03Z 合併（`a9c61945b6af1101c024c0566a2cfb2f91399344`），三項 CI success、獨立 ACCEPT，main／tree 已回讀。P-01～P-05 的實作與驗證完成；desk 保留 owner 驗收待定，journal 同步本輪事實。

## T-0439 — M3 本機工作目錄接入

[desk](https://github.com/fallrising/desk/blob/main/tasks/T-0439-graphify-local-workspace/task.md)／[設計](../milestones/local-workspace.md)。Owner 要求接續；先寫規格，再實作。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0439-01 | 明確來源與共用索引入口 | W-01 | done | 2026-10-29T17:33:47Z | 2026-10-29T17:52:57Z | 2026-10-29T17:53:18Z |
| T-0439-02 | 查詢與來源讀回邊界 | W-02 | done | 2026-10-29T17:33:47Z | 2026-10-29T17:52:57Z | 2026-10-29T17:53:18Z |
| T-0439-03 | 可變來源與失效驗證 | W-03 | done | 2026-10-29T17:33:47Z | 2026-10-29T17:52:57Z | 2026-10-29T17:53:18Z |
| T-0439-04 | 真實較大元件及 MCP | W-04 | done | 2026-10-29T17:33:47Z | 2026-10-29T17:52:57Z | 2026-10-29T17:53:18Z |
| T-0439-05 | 必要驗證與交付 | W-05 | done | 2026-10-29T17:33:47Z | 2026-10-29T17:52:57Z | 2026-10-29T17:53:18Z |

W-01～W-05 的實作、文件、必要驗證與獨立審查已通過；[本輪證據](../evidence/local-workspace/README.md)／[審查](../evidence/local-workspace/review.md)。
[PR #791](https://github.com/fallrising/newclear/pull/791) 於 2026-10-29T17:52:57Z 合併，commit `a183b6568b2ee0b0253ec6fcaab5d0276c45b7b5`；遠端內容與 reviewed head `16548cb7875e1aab8e875e6c63bbcea6c6fc17f2` 的本次所有路徑一致。

必要 CI 全部 success：[真場景與56tests](https://github.com/fallrising/newclear/actions/runs/40925281310)、[llms](https://github.com/fallrising/newclear/actions/runs/40925281311)、[success contracts](https://github.com/fallrising/newclear/actions/runs/40925281329)、[workflow validation](https://github.com/fallrising/newclear/actions/runs/40925281529)。
20分鐘檢查點：實作已合併，剩餘工作僅本任務板與 desk／journal 事實同步；無新增需求或未解 must-fix。
本 PR 僅關閉技術任務；desk 的 owner 驗收狀態仍保留，由 ledger 收尾 PR 同步。沒有 release／deploy，沒有啟動下一里程碑。

限制仍成立：MCP 修改來源後須重啟；最短路徑可能走 contains，calls 必須另外核對；未量測 provider usage／tokens／cost。

## T-0441 — M4 圖更新與有向呼叫路徑

[desk](https://github.com/fallrising/desk/blob/main/tasks/T-0441-graphify-live-workspace/task.md)／[規格](../milestones/live-workspace.md)。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0441-01 | 過期與讀取邊界 | L-01 | done | 2026-10-29T18:08:39Z | 2026-10-29T18:26:26Z | 2026-10-29T18:26:26Z |
| T-0441-02 | 明確原子刷新 | L-02 | done | 2026-10-29T18:08:39Z | 2026-10-29T18:26:26Z | 2026-10-29T18:26:26Z |
| T-0441-03 | 有向calls路徑 | L-03 | done | 2026-10-29T18:08:39Z | 2026-10-29T18:26:26Z | 2026-10-29T18:26:26Z |
| T-0441-04 | 真stdio完整流程 | L-04 | done | 2026-10-29T18:08:39Z | 2026-10-29T18:26:26Z | 2026-10-29T18:26:26Z |
| T-0441-05 | 驗證審查與交付 | L-05 | done | 2026-10-29T18:08:39Z | 2026-10-29T18:26:26Z | 2026-10-29T18:26:26Z |

L-01～L-05 實作、文件與必要驗證已交付；[證據與限制](../evidence/live-workspace/README.md)／[獨立ACCEPT](../evidence/live-workspace/review.md)。
[PR #802](https://github.com/fallrising/newclear/pull/802) 於2026-10-29T18:26:26Z合併，commit `d5a95c6d1e833700e41ae491b510e228ca7244b3`；本次所有路徑與reviewed head `53569b87fb7ed1e82b6233cd978bec0d8c6f64e0` 完全相同，遠端已回讀。
四項CI success：[Graphify81tests/真場景](https://github.com/fallrising/newclear/actions/runs/40930383675)、[llms](https://github.com/fallrising/newclear/actions/runs/40930383592)、[success contracts](https://github.com/fallrising/newclear/actions/runs/40930383715)、[workflow](https://github.com/fallrising/newclear/actions/runs/40930383793)。
唯一review must-fix（failed callback漏postvalidation）已先RED再修正，13state獨立複查與最終81tests通過；無未解阻擋問題。
本PR只記錄技術任務完成；desk/journal另外同步事實，owner驗收與release/deploy分開。沒有擴張下一里程碑。
限制：檢查只代表觀測時點，無watcher/自動刷新；calls是靜態邊，搜尋上限不代表無路徑；provider/tokens/cost未量測。
