# Graphify lab 技術任務板

## T-0001 — 開發場景與單份參考實驗

來源：owner 於 2026-10-29 直接指示。Session `Graphify-20261029`；base `68c92afda47187ec40a8dff319eb377da9998145`；branch `agent/graphify-lab-20261029`。
主導負責整合與 Git 交付；worker 分別研究上游、實作 cache 與 scenarios；獨立 reviewer 核對證據與正負例。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 固定版本與來源（等 owner 審閱） | AC-01 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-02 | 導覽與呼叫路徑（等 owner 審閱） | AC-02 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-03 | 真實元件參考（等 owner 審閱） | AC-03 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-04 | 影響與測試線索（等 owner 審閱） | AC-04 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-05 | 更新與失效（等 owner 審閱） | AC-05 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-06 | 跨圖與歧義控制（等 owner 審閱） | AC-06 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-07 | 共用 cache（等 owner 審閱） | AC-07 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-08 | 空間與時間量測（等 owner 審閱） | AC-08 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |
| T-0001-09 | MCP／CI／審查與交付（等 owner 審閱） | AC-09 | in_progress | 2026-10-29T13:38:06Z | — | 2026-10-29T14:03:53Z |

## 驗證與交付

- Runtime commit：`011fa8cac6137735b576e14b5695ea26544e91db`；GitHub app 原子 tree／commit、非 force fast-forward、回讀 ref／tree。
- [Draft PR #759](https://github.com/fallrising/newclear/pull/759)；[SUCCESS](../../SUCCESS.md) 的 AC-01～09 均有實際通過證據。
- [7 組場景、29 項邊界測試、4 項 CI](../evidence/README.md)，[獨立 ACCEPT](../evidence/review.md)；唯一 P2 cache context 問題已修復。
- 所有列已完成實作與本次驗證，目前等 owner 審閱 Draft。未取得 merge 授權，故保持 in_progress／end 未填；不冒稱合併結案。
- 上游 private paths／付費 API／部署沒有納入這次公開實驗；已知解析與效能解讀邊界仍保留。
