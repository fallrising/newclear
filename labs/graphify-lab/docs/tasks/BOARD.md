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
| T-0437-M1 | 同步第一輪已合併／已完成狀態與索引 | M1 | in_progress | 2026-10-29T16:58:00Z | — | 2026-10-29T16:58:00Z |
| T-0437-01 | 固定來源與真 graph 導覽 | P-01 | todo | — | — | 2026-10-29T16:58:00Z |
| T-0437-02 | 共用來源模組重構與回歸 | P-02 | todo | — | — | 2026-10-29T16:58:00Z |
| T-0437-03 | 本機 agent recipe 與真 MCP | P-03 | todo | — | — | 2026-10-29T16:58:00Z |
| T-0437-04 | 可重跑對照與誠實成本紀錄 | P-04 | todo | — | — | 2026-10-29T16:58:00Z |
| T-0437-05 | 證據、獨立審查、CI 與交付 | P-05 | todo | — | — | 2026-10-29T16:58:00Z |
