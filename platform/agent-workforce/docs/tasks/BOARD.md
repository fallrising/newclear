# Agent Workforce 技術任務板

本項目的技術任務放在這裡。每張連回 desk 大需求卡的 id；desk 只看大方向，細節在此。欄位依 desk [運作方法](https://github.com/fallrising/desk/blob/main/docs/operating-method.md) §4：每張預期 30 分鐘內完成，進行中刷新 `last_activity`（UTC RFC3339）；沒有 `end` 且 `last_activity` 早於預期時長三倍（90 分鐘）算卡住。

狀態只用 `todo`、`in_progress`、`done`。關閉後留在本表，可以重開。

## T-0366 跨節點需求第一片（XN-01/03/04/06，單機）

設計：[xn-slice1-design.md](../xn-slice1-design.md)；驗收：[verification §12](../verification.md#12-xn-第一片fake設計中)。

**設計決定已由 owner 2026-10-20 採納；XS-1 合併後即可從 XS-2 開始。**

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| XS-1 | 技術設計與 XN-AC 案例（#437，只有文件） | 全部 | done | 2026-10-20T12:35:00Z | 2026-10-20T12:59:36Z | 2026-10-20T12:59:36Z |
| XS-2 | Schema v2：三張新表、版本檢查 0／1／2、`ProtocolStore` 骨架與故障點 | XN-AC-2、20 | todo | | | |
| XS-3 | `access.py`：normalize、evaluate、widens；`put_access_policy` | XN-AC-16～19、21 | todo | | | |
| XS-4 | `Controller.receive` 分流與存取檢查；`receive_message` 拒收 `receipt`；`receive_protocol_response` | XN-AC-1、12～15、20 | todo | | | |
| XS-5 | `dispose`、`mark_handled`、`settle_inbox` 與回應狀態對應 | XN-AC-8～11 | todo | | | |
| XS-6 | `flush_responses`、fake `ResponseTransport`、`release_held_response`、退避與上限 | XN-AC-3～7 | todo | | | |
| XS-7 | 回填 m1.md、verification §12 的實測結果與 README 狀態；不宣稱跨節點可用 | 全部 | todo | | | |
