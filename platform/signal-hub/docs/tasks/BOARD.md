# Signal Hub 技術任務板

本板依根 AGENTS 追蹤新任務；原歷史留在 [STATUS](../STATUS.md) 與 [.team/PLAN](../../.team/PLAN.md)，不重寫或重編歷史。產品進度權威仍是 STATUS。

## P05 — 單一有用事件來源提案

Owner 直接指示；[計畫及 AC](../../.team/PLAN.md#p05--單一有用事件來源提案2026-11-22)。

| ID | 任務 | AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P05-1 | 事件、時間與重送邊界 | P05-01 | done | 2026-11-22T14:16:40Z | 2026-11-22T14:26:33Z | 2026-11-22T14:28:39Z |
| P05-2 | 單一來源及比較 | P05-02 | done | 2026-11-22T14:16:40Z | 2026-11-22T14:26:33Z | 2026-11-22T14:28:39Z |
| P05-3 | M6及跨元件責任保留 | P05-03 | done | 2026-11-22T14:16:40Z | 2026-11-22T14:26:33Z | 2026-11-22T14:28:39Z |
| P05-4 | 旅程、合成預期及交付 | P05-04 | done | 2026-11-22T14:16:40Z | 2026-11-22T14:26:33Z | 2026-11-22T14:28:39Z |

交付紀錄：以上 `end` 為 [PR #1075](https://github.com/fallrising/newclear/pull/1075) 的實際合併時間；head `2b6a19d4cd6b6c297c1a1009ed9b60bd9991c9be`，merge `06b771cd73797d659edf384b2599bc4068f6dcd0`。已 fetch 遠端 main，核對 head 為祖先及 Signal Hub 內容一致。

- 本地文件驗證：24份固定來源、19個公開版本連結、70個相對連結、兩段合成 JSON 對既有 event schema 通過；55份 project contracts、9份 llms 導航、task/report validators、staged diff 通過。
- 獨立審查：一名 Codex reviewer 兩輪 ACCEPT，主導接受；[審查報告](../../.team/reports/T-901.md)。
- 最終 head CI：[Signal Hub CI](https://github.com/fallrising/newclear/actions/runs/45032518817)（verify、docker-package）與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/45032518793) 均 success。
- 本次完成的是來源提案與合成預期；沒有執行真來源註冊、投遞、部署或產品模型呼叫。原 AC-04 的真來源、非 root 持久實例與該實例備份驗收仍 pending；合成恢復證據不代替真實操作證據。

本紀錄更新 P05 合併前的交付等待狀態，不改動原 SUCCESS／SDD／產品進度資格。整體需求的驗收仍由 owner 決定。
